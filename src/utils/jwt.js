const jwt = require("jsonwebtoken");
const {JWT_SECRET, JWT_EXPIRES} = require("../config/env");

 function generateToken(payload){
    return jwt.sign(payload, JWT_SECRET, {expiresIn:JWT_EXPIRES})
 }

 module.exports = generateToken;