/**
 * JWT helpers — sign access/refresh token pairs and verify them, driven entirely
 * by `config.app.lib.jwt`.
 *
 * Works with both symmetric and asymmetric algorithms: HMAC (HS256) signs and
 * verifies with the same shared secret (`JWT_PRIVATE_KEY`), while asymmetric
 * algorithms (RS/ES/PS families) sign with the private key and verify with the
 * public one.
 *
 * @author: k13.conf - Abdelghani EL Mouak
 */
import jwt from "jsonwebtoken";
import config from "@config/app.config.js";

/** Reserved claim distinguishing the two token kinds. */
export type TokenType = "access" | "refresh";

/** A freshly minted access + refresh token pair. */
export interface JWTTokens {
    accessToken: string;
    refreshToken: string;
}

/** Asymmetric algorithms sign with the private key and verify with the public one. */
function isAsymmetric(algorithm: string): boolean {
    return /^(RS|ES|PS)/.test(algorithm);
}

/** Key used to sign — the private key for asymmetric algorithms, the shared secret for HMAC. */
function signingKey(): string {
    return config.app.lib.jwt.privateKey;
}

/** Key used to verify — the public key for asymmetric algorithms, the shared secret for HMAC. */
function verificationKey(): string {
    const { algorithm, privateKey, publicKey } = config.app.lib.jwt;
    return isAsymmetric(algorithm) ? publicKey : privateKey;
}

/**
 * Generates an access + refresh token for the given payload. The access token
 * lives for `JWT_EXPIRES_IN`, the refresh token for `JWT_REFRESH_EXPIRES_IN`;
 * each carries a reserved `type` claim so the two can't be used interchangeably
 * (see {@link verifyAccessToken} / {@link verifyRefreshToken}).
 *
 * `options` may override signing options (issuer, audience, …), but not the
 * per-token `expiresIn`, which is fixed by config to keep the lifetimes correct.
 */
export function generateJWTTokens(payload: jwt.JwtPayload, options?: jwt.SignOptions): JWTTokens {
    const { algorithm, expiresIn, refreshExpiresIn } = config.app.lib.jwt;
    const key = signingKey();
    const base: jwt.SignOptions = { ...options, algorithm };

    const accessToken = jwt.sign({ ...payload, type: "access" satisfies TokenType }, key, {
        ...base,
        expiresIn,
    });
    const refreshToken = jwt.sign({ ...payload, type: "refresh" satisfies TokenType }, key, {
        ...base,
        expiresIn: refreshExpiresIn,
    });

    return { accessToken, refreshToken };
}

/**
 * Verifies a token's signature and expiry and returns its payload. Throws
 * jsonwebtoken's `TokenExpiredError` / `JsonWebTokenError` when invalid.
 */
export function verifyJWTToken(token: string, options?: jwt.VerifyOptions): jwt.JwtPayload {
    const { algorithm } = config.app.lib.jwt;
    const decoded = jwt.verify(token, verificationKey(), { algorithms: [algorithm], ...options });
    return decoded as jwt.JwtPayload;
}

/** Verifies a token and asserts it is of the expected kind. */
function verifyTyped(token: string, expected: TokenType, options?: jwt.VerifyOptions): jwt.JwtPayload {
    const payload = verifyJWTToken(token, options);
    if (payload.type !== expected) {
        throw new jwt.JsonWebTokenError(`Expected a ${expected} token`);
    }
    return payload;
}

/** Verifies an access token (rejects refresh tokens). */
export function verifyAccessToken(token: string, options?: jwt.VerifyOptions): jwt.JwtPayload {
    return verifyTyped(token, "access", options);
}

/** Verifies a refresh token (rejects access tokens). */
export function verifyRefreshToken(token: string, options?: jwt.VerifyOptions): jwt.JwtPayload {
    return verifyTyped(token, "refresh", options);
}
