const dotenv = require('dotenv');
dotenv.config();

exports.PORT = process.env.PORT || 5000;
exports.MONGO_URI = process.env.MONGO_URI;
exports.JWT_SECRET = process.env.JWT_SECRET || 'replace_me';
exports.JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';
exports.CLIENT_URL = process.env.CLIENT_URL