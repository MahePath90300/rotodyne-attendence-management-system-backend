const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    email:{type:String, required:true, unique:true},
    password:{type:String, required:true},
    employeeId:{type:String, required:true, unique:true},
    company:{type:String, required:true},
    site:{type:String, required:true},
    role:{type:String, required:true} ,
    lastLoginDate: { type: String, default: null }
},

{timestamps:true}

)

module.exports = mongoose.model("User",userSchema)