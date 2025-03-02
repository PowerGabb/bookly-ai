import prisma from "./prisma.js";

export const generateReferralCode = async () => {
  const length = 8;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  while (true) {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Cek apakah kode sudah digunakan
    const existing = await prisma.user.findUnique({
      where: { referral_code: code }
    });
    
    if (!existing) {
      return code;
    }
  }
}; 