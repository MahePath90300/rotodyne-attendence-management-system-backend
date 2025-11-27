const jwt = require("jsonwebtoken");
const {JWT_SECRET} = require("../config/env");
const { token } = require("morgan");

function protect(req, res, next){
const token = req.cookies && req.cookies.token;

if(!token){
    return res.status(401).json({message:"Not authorized, no token"})
}

try{
const decoded = jwt.verify(token, JWT_SECRET);
req.user = decoded;
next()
}catch(e){
return res.status(401).json({message:"Not authorized, token failed"})
}
}


module.exports = protect;