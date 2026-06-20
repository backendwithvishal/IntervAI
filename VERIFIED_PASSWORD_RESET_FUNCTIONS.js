// ============================================
// VERIFIED PASSWORD RESET FUNCTIONS
// Copy these 3 functions to controllers/userController.js
// ============================================

import { User } from "../models/user.model.js";
import bcrypt from 'bcryptjs';
import { OTPService } from '../services/otpService.js';
import { EmailService } from '../services/emailService.js';

// ============================================
// FUNCTION 1: Forgot Password (Request OTP)
// ============================================
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        // Validation: Email required
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        // Validation: Email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        // Rate limiting: Check attempts
        const attempts = await OTPService.trackOTPRequest(email);
        const maxAttempts = parseInt(process.env.OTP_RATE_LIMIT_MAX) || 3;
        
        if (attempts > maxAttempts) {
            return res.status(429).json({
                success: false,
                message: "Too many OTP requests. Please try again in 1 hour"
            });
        }

        // Check if user exists
        const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
        
        // Security: Always return success (prevent email enumeration)
        if (!user) {
            return res.status(200).json({
                success: true,
                message: "If the email exists, an OTP has been sent"
            });
        }

        // Generate OTP
        const otp = OTPService.generateOTP();
        const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;

        // Store OTP in Redis
        await OTPService.storeOTP(email, otp, expiryMinutes);

        // Send OTP email
        try {
            await EmailService.sendOTPEmail(email, otp, user.fullname);
        } catch (emailError) {
            console.error('[forgotPassword] Email send failed:', emailError);
            // Cleanup: Delete OTP if email fails
            await OTPService.deleteOTP(email);
            return res.status(500).json({
                success: false,
                message: "Failed to send OTP email. Please try again"
            });
        }

        console.log(`[forgotPassword] OTP sent to ${email}, attempts: ${attempts}/${maxAttempts}`);

        return res.status(200).json({
            success: true,
            message: "If the email exists, an OTP has been sent",
            data: {
                expiresIn: `${expiryMinutes} minutes`
            }
        });
    } catch (error) {
        console.error('[forgotPassword]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// ============================================
// FUNCTION 2: Verify OTP
// ============================================
export const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        // Validation: Both fields required
        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: "Email and OTP are required"
            });
        }

        // Validation: Email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        // Track verification attempts
        const verifyAttempts = await OTPService.trackOTPVerification(email);
        const maxVerifyAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS) || 3;

        // Check max attempts
        if (verifyAttempts > maxVerifyAttempts) {
            // Security: Delete OTP after max attempts
            await OTPService.deleteOTP(email);
            return res.status(429).json({
                success: false,
                message: "Too many verification attempts. Please request a new OTP"
            });
        }

        // Verify OTP
        const isValid = await OTPService.verifyOTP(email, otp);

        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP",
                data: {
                    attemptsRemaining: maxVerifyAttempts - verifyAttempts
                }
            });
        }

        // Get remaining TTL
        const ttl = await OTPService.getOTPTTL(email);

        console.log(`[verifyOTP] OTP verified for ${email}`);

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            data: {
                expiresIn: ttl > 0 ? `${Math.floor(ttl / 60)} minutes` : 'soon'
            }
        });
    } catch (error) {
        console.error('[verifyOTP]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// ============================================
// FUNCTION 3: Reset Password
// ============================================
export const resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        // Validation: All fields required
        if (!email || !otp || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Email, OTP, and new password are required"
            });
        }

        // Validation: Email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format"
            });
        }

        // Validation: Password strength
        const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH) || 6;
        if (newPassword.length < minLength) {
            return res.status(400).json({
                success: false,
                message: `Password must be at least ${minLength} characters`
            });
        }

        // Verify OTP one final time
        const isValid = await OTPService.verifyOTP(email, otp);

        if (!isValid) {
            return res.status(400).json({
                success: false,
                message: "Invalid or expired OTP"
            });
        }

        // Find user (include password for comparison)
        const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

        if (!user) {
            // Cleanup: Delete OTP even if user not found
            await OTPService.deleteOTP(email);
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Security: Check if new password is same as old password
        const isSamePassword = await bcrypt.compare(newPassword, user.password);
        if (isSamePassword) {
            return res.status(400).json({
                success: false,
                message: "New password cannot be the same as old password"
            });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        // Update password in database
        await User.findByIdAndUpdate(user._id, { 
            password: hashedPassword 
        });

        // Cleanup: Delete OTP after successful reset
        await OTPService.deleteOTP(email);

        // Send confirmation email (async, don't wait)
        EmailService.sendPasswordChangeConfirmation(email, user.fullname).catch(err => {
            console.error('[resetPassword] Confirmation email failed:', err);
        });

        console.log(`[resetPassword] Password reset successful for ${email}`);

        return res.status(200).json({
            success: true,
            message: "Password reset successfully. You can now login with your new password"
        });
    } catch (error) {
        console.error('[resetPassword]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

// ============================================
// TESTING GUIDE
// ============================================

/*
TEST 1: Request OTP
-------------------
curl -X POST http://localhost:8000/api/v1/user/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

Expected Response:
{
  "success": true,
  "message": "If the email exists, an OTP has been sent",
  "data": {
    "expiresIn": "10 minutes"
  }
}


TEST 2: Verify OTP
------------------
curl -X POST http://localhost:8000/api/v1/user/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","otp":"123456"}'

Expected Response:
{
  "success": true,
  "message": "OTP verified successfully",
  "data": {
    "expiresIn": "9 minutes"
  }
}


TEST 3: Reset Password
----------------------
curl -X POST http://localhost:8000/api/v1/user/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email":"test@example.com",
    "otp":"123456",
    "newPassword":"NewPassword123!"
  }'

Expected Response:
{
  "success": true,
  "message": "Password reset successfully. You can now login with your new password"
}


TEST 4: Login with New Password
--------------------------------
curl -X POST http://localhost:8000/api/v1/user/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"NewPassword123!"}'

Expected Response:
{
  "success": true,
  "message": "Welcome back, Test User",
  "data": {
    "user": { ... }
  }
}
*/

// ============================================
// COMMON ISSUES & SOLUTIONS
// ============================================

/*
ISSUE 1: "Email is required"
SOLUTION: Make sure you're sending email in request body

ISSUE 2: "Invalid email format"
SOLUTION: Check email format (must be valid email)

ISSUE 3: "Too many OTP requests"
SOLUTION: Wait 1 hour or clear Redis: DEL otp:attempts:email

ISSUE 4: "Invalid or expired OTP"
SOLUTION: Check OTP in Redis: GET otp:email@example.com

ISSUE 5: "Failed to send OTP email"
SOLUTION: Check email configuration in .env

ISSUE 6: "User not found"
SOLUTION: Make sure user is registered first

ISSUE 7: "New password cannot be the same as old password"
SOLUTION: Use a different password

ISSUE 8: Functions not exported
SOLUTION: Make sure these are exported in userController.js
*/
