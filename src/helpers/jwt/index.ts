/**
 * This file is utility helper for JWT (JSON Web Token) operations.
 * @author: k13.conf - Abdelghani EL Mouak
 */
import jwt from "jsonwebtoken";
import config from "@config/app.config.js";



export function generateJWTTokens(payload: jwt.JwtPayload, options?: jwt.SignOptions) {
    // Step 1: get the config 
    const {
        algorithm,
        privateKey,
        publicKey,
        expiresIn,
        refreshExpiresIn
    } = config.app.lib.jwt;

    // Step 2: generate the JWT token
    const signOptions: jwt.SignOptions = {
        algorithm: algorithm as jwt.Algorithm,
        expiresIn: expiresIn,
        ...options
    };
    const jwtToken = jwt.sign(payload, privateKey, );

    return {
        jwtToken: "",
        refreshToken: "",
    }
}