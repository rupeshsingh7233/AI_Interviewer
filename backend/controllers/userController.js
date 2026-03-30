import expressAsyncHandler from "express-async-handler";
import AsyncHandler from "express-async-handler";
import User from "../models/User.js";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import e from "express";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: "1d",

    });
}

const registerUser = expressAsyncHandler(async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
        res.status(400);
        throw new Error("Please add all fields");
    }
    const userExists = await User.findOne({ email });
    if (userExists) {
        res.status(400);
        throw new Error("User already exists");
    }
    const user = await User.create({
        name,
        email,
        password,
    })
    if (user) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            token: generateToken(user._id),
        });
    } else {
        res.status(400);
        throw new Error("Invalid user data");
    }
});


const loginUser = AsyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        res.status(400);
        throw new Error("Please add all fields");
    }
    const user = await User.findOne({ email });
    if (user && (await user.matchPassword(password))) {
        res.status(201).json({
            _id: user._id,
            name: user.name,
            email: user.email,
            preferredRole: user.preferredRole,
            token: generateToken(user._id),
        });
    } else {
        res.status(400);
        throw new Error("Invalid credentials");
    }    
})

const googleLogin = AsyncHandler(async (req, res) => {
    const { tokenId } = req.body;
    const ticket = await client.verifyIdToken({
        idToken: tokenId,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email_verified, name, email, sub: googleId } = ticket.getPayload();
    if (!email_verified) {
        res.status(400);
        throw new Error("Google Login Failed");
    }
    let user = await User.findOne({ email });
    if (user) {
        if (!user.googleId) {
            user.googleId = googleId;
            await user.save();
        }
    }
    else {
        userser = await User.create({
            name,
            email,
            googleId,
            password: null
        });
    }
    res.status(201).json({
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        prefferedRole: newUser.prefferedRole,
        token: generateToken(newUser._id),
    });
});

const getUserProfile = AsyncHandler(async (req, res) => {
    if (req.user) {
        res.status(200).json({
            _id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            prefferedRole: req.user.preferredRole
        });
    }
    else {
        res.status(404);
        throw new Error("User not found");
    }
});

const updateUserProfile = AsyncHandler(async (req, res) => {
    if (req.user) {
        const user = await User.findById(req.user._id);

        user.name = req.body.name || user.name;
        user.email = req.body.email || user.email;
        user.preferredRole = req.body.preferredRole || user.preferredRole;

        if (req.body.password) {
            user.password = req.body.password;
        }

        const updatedUser = await user.save();

        res.status(200).json({
            _id: updatedUser._id,
            name: updatedUser.name,
            email: updatedUser.email,
            preferredRole: updatedUser.preferredRole 
        });

    } else {
        res.status(404);
        throw new Error("User not found");
    }
});

export { registerUser, loginUser, googleLogin, getUserProfile, updateUserProfile };