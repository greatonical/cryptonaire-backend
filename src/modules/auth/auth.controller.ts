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

// === viem (EOA + smart wallet verify) ===
import {
  createPublicClient,
  http,
  verifyMessage,
  isAddress,
  hashMessage,
} from "viem";
import { base, baseSepolia } from "viem/chains";

function makeClient(chainId: number) {
  // If you sign on Base Sepolia (dev), use its chain + public RPC by default
  if (chainId === 84532) {
    const rpc = process.env.BASE_RPC_URL || "https://sepolia.base.org";
    return createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  }
  // Default to Base mainnet (prod)
  const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return createPublicClient({ chain: base, transport: http(rpc) });
}

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
    try {
      // Parse message (no signature check yet)
      const parsed = new SiweMessage(dto.message);

      // Expected envs (prod/dev)
      const expectedDomain = process.env.SIWE_DOMAIN || "localhost:3000";
      const expectedUri = (process.env.SIWE_URI || "http://localhost:3000").replace(/\/$/, "");
      const expectedChain = Number(process.env.BASE_CHAIN_ID || 8453);
      const normalize = (s: string) => s.replace(/\/$/, "");

      // Domain/URI/Chain checks
      if (parsed.domain !== expectedDomain) {
        throw new UnauthorizedException("Domain mismatch");
      }
      if (normalize(String(parsed.uri)) !== expectedUri) {
        throw new UnauthorizedException("URI mismatch");
      }
      if (Number(parsed.chainId) !== expectedChain) {
        throw new UnauthorizedException("Wrong chain");
      }
      if (!isAddress(parsed.address as `0x${string}`)) {
        throw new UnauthorizedException("Bad address");
      }

      // Canonical EIP-4361 string
      const prepared = parsed.prepareMessage();
      const signature = dto.signature as `0x${string}`;
      const address = parsed.address as `0x${string}`;

      // 1) EOA path (MetaMask/Rabby)
      let okEOA = false;
      try {
        okEOA = await verifyMessage({ address, message: prepared, signature });
      } catch {
        okEOA = false;
      }

      // 2) Smart wallet path (EIP-1271) for Base app / smart accounts
      let ok1271 = false;
      if (!okEOA) {
        const client = makeClient(Number(parsed.chainId));
        const MAGIC_1271 = "0x1626ba7e";
        const digest = hashMessage(prepared);
        try {
          const result = await client.readContract({
            address,
            abi: [
              {
                type: "function",
                name: "isValidSignature",
                stateMutability: "view",
                inputs: [
                  { name: "hash", type: "bytes32" },
                  { name: "signature", type: "bytes" },
                ],
                outputs: [{ name: "magicValue", type: "bytes4" }],
              },
            ] as const,
            functionName: "isValidSignature",
            args: [digest, signature],
          });
          ok1271 = String(result).toLowerCase() === MAGIC_1271;
        } catch {
          ok1271 = false;
        }
      }

      if (!okEOA && !ok1271) {
        const is6492 = (signature as string).startsWith("0x64926492");
        const reason = is6492 ? "EIP-6492 signature not accepted" : "Signature invalid";
        throw new UnauthorizedException(reason);
      }

      // (Optional) Compare/consume nonce if you store it server-side
      // await this.siwe.consumeNonce(address.toLowerCase(), parsed.nonce);

      // Optional: Farcaster user id in resources
      const farcasterUserId = parsed.resources
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
    } catch (err: any) {
      // Force clean 401 for verify issues instead of 500
      const msg = err?.message || "SIWE verify failed";
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(msg);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  async me(@CurrentUser() user: any) {
    return { user };
  }
}

@Controller("auth/minikit")
export class MiniKitAuthController {
  // Create once; optional: inject via a provider
  private appClient = createAppClient({
    relay: "https://relay.farcaster.xyz",
    ethereum: viemConnector({ rpcUrl: process.env.BASE_RPC_URL }), // optional for faster reads
  });

  @Post("verify")
  async verify(@Body() body: unknown) {
    const { fid, message, signature } = VerifyDto.parse(body);

    let parsed: SiweMessage;
    try {
      parsed = new SiweMessage(message);
    } catch {
      throw new UnauthorizedException("Invalid SIWF message");
    }
    const msgNonce = parsed.nonce;
    const msgDomain = parsed.domain;

    const expectedDomain = process.env.MINIAPP_DOMAIN || msgDomain;
    if (expectedDomain !== msgDomain) {
      throw new UnauthorizedException("Domain mismatch");
    }

    const { success, fid: verifiedFid } =
      await this.appClient.verifySignInMessage({
        nonce: msgNonce,
        domain: expectedDomain,
        message,
        signature: signature as `0x${string}`,
        acceptAuthAddress: true,
      });

    if (!success || String(verifiedFid) !== String(fid)) {
      throw new UnauthorizedException("Invalid Farcaster auth");
    }

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