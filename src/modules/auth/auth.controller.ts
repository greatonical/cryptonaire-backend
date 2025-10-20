import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import { SiweService } from "@modules/auth/siwe.service";
import { AuthService } from "@modules/auth/auth.service";
import { SiweChallengeDto } from "@modules/auth/dto/siwe-challenge.dto";
import { SiweVerifyDto } from "@modules/auth/dto/siwe-verify.dto";
import { JwtAuthGuard } from "@common/guards/jwt.guard";
import { CurrentUser } from "@common/decorators/current-user.decorator";
import * as jose from "jose";
import { verifySignInMessage } from "@farcaster/auth-client";
import { VerifyDto } from "./dto/minikit-verify.dto";
import { createAppClient, viemConnector } from "@farcaster/auth-client";
import { SiweMessage } from "siwe";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly siwe: SiweService,
    private readonly auth: AuthService
  ) {}

  @Post("siwe/challenge")
  async siweChallenge(@Body() dto: SiweChallengeDto) {
    return this.siwe.createChallenge(dto.walletAddress);
  }

  @Post("siwe/verify")
  async siweVerify(@Body() dto: SiweVerifyDto) {
    // use SiweMessage instead of JSON.parse
    const siwe = new SiweMessage(dto.message);

    // 1) check domain/uri/chain against envs
    const domain = process.env.SIWE_DOMAIN || "localhost:3000";
    const uri = process.env.SIWE_URI || "http://localhost:3000";
    const chainId = Number(process.env.BASE_CHAIN_ID || 8453);
    if (siwe.domain !== domain)
      throw new UnauthorizedException("Domain mismatch");
    if (siwe.uri !== uri) throw new UnauthorizedException("URI mismatch");
    if (Number(siwe.chainId) !== chainId)
      throw new UnauthorizedException("Wrong chain");

    // 2) verify signature (and your nonce store)
    await this.siwe.verify(dto.message, dto.signature); // or siwe.verify({ signature })
    // (if you use a nonce store, consume it here)

    // 3) get address and optional Farcaster id from signed resources
    const address = siwe.address;
    const farcasterUserId = siwe.resources
      ?.find((r) => r.startsWith("farcaster://user/"))
      ?.split("/")
      .pop();

    const user = await this.auth.upsertUserByWallet(address, farcasterUserId);
    const token = await this.auth.issueJwt(user);
    return {
      token,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        farcasterUserId: user.farcasterUserId,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@CurrentUser() user: any) {
    return { user };
  }
}

@Controller("auth/minikit")
export class MiniKitAuthController {
  // Create the App Client once; you can also inject this if you prefer
  private appClient = createAppClient({
    relay: "https://relay.farcaster.xyz",
    // Optional: pass your own RPC to speed up contract reads (not required)
    ethereum: viemConnector({ rpcUrl: process.env.BASE_RPC_URL }),
  });

  @Post("verify")
  async verify(@Body() body: unknown) {
    const { fid, message, signature } = VerifyDto.parse(body);

    // Parse SIWF message to extract nonce & domain
    let parsed: SiweMessage;
    try {
      parsed = new SiweMessage(message);
    } catch {
      throw new UnauthorizedException("Invalid SIWF message");
    }
    const msgNonce = parsed.nonce;
    const msgDomain = parsed.domain;

    // Optionally enforce your domain
    const expectedDomain = process.env.MINIAPP_DOMAIN || msgDomain;
    if (expectedDomain !== msgDomain) {
      throw new UnauthorizedException("Domain mismatch");
    }

    // Verify signature via Farcaster Auth client
    const { success, fid: verifiedFid } =
      await this.appClient.verifySignInMessage({
        nonce: msgNonce,
        domain: expectedDomain,
        message,
        signature: signature as `0x${string}`,
        // Accept auth address signatures as well as custody (recommended)
        acceptAuthAddress: true,
      });

    if (!success || String(verifiedFid) !== String(fid)) {
      throw new UnauthorizedException("Invalid Farcaster auth");
    }

    // Mint your app JWT (RS256) embedding FID
    const privateKeyPem = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!privateKeyPem) throw new Error("Missing JWT_PRIVATE_KEY");
    const privateKey = await jose.importPKCS8(privateKeyPem, "RS256");

    const token = await new jose.SignJWT({ sub: fid, typ: "app", fid })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(process.env.JWT_ISSUER!)
      .setAudience(process.env.JWT_AUDIENCE!)
      .setIssuedAt()
      .setExpirationTime(`${process.env.JWT_TTL_MINUTES || 20}m`)
      .sign(privateKey);

    return { token };
  }
}
