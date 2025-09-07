// TODO
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

function readPublicKey() {
  const key = process.env.JWT_PUBLIC_KEY;
  if (!key) throw new Error('JWT_PUBLIC_KEY missing');
  return key.replace(/\\n/g, '\n');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      secretOrKey: readPublicKey(),
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    });
  }
  async validate(payload: any) {
    return payload; // attached to request.user
  }
}