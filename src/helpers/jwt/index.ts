/**
 * This file is utility helper for JWT (JSON Web Token) operations.
 * @author: k13.conf - Abdelghani EL Mouak
 */
import jwt from "jsonwebtoken";
import config from "@config/app.config.js";


/**
 * Generates a JWT token and a refresh token based on the provided payload and options.
 * @param payload - The payload to include in the JWT token.
 * @param options - Optional signing options for the JWT token.
 * @returns An object containing the generated JWT token and refresh token.
 */
export function generateJWTTokens(payload: jwt.JwtPayload, options?: jwt.SignOptions) {
    // Step 1: get the config 
    const {
        algorithm,
        privateKey,
        expiresIn,
        refreshExpiresIn
    } = config.app.lib.jwt;

    // Step 2: generate the JWT token
    const signOptions: jwt.SignOptions = {
        algorithm: algorithm as jwt.Algorithm,
        ...options
    };
    const jwtToken = jwt.sign(payload, privateKey, { ...signOptions, expiresIn: expiresIn });

    // Step 3: generate the refresh token
    const refreshToken = jwt.sign({ payload, type: "refresh", }, privateKey, { ...signOptions, expiresIn: refreshExpiresIn });

    return {
        jwtToken: jwtToken,
        refreshToken: refreshToken,
    }
}

/**
 * Verifies a JWT token and returns the decoded payload if valid.
 * @param token - The JWT token to verify.
 * @param options - Optional verification options for the JWT token.
 * @returns The decoded payload if the token is valid; otherwise, throws an error.
 */
export function verifyJWTToken(token: string, options?: jwt.VerifyOptions): jwt.JwtPayload {
    // Step 1: get the config 
    const {
        algorithm,
        publicKey,
    } = config.app.lib.jwt;

    // Step 2: verify the JWT token
    const verifyOptions: jwt.VerifyOptions = {
        algorithms: [algorithm as jwt.Algorithm],
        ...options
    };
    const decoded = jwt.verify(token, publicKey, verifyOptions);

    return decoded as jwt.JwtPayload;
}