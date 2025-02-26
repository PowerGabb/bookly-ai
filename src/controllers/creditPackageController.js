import prisma from "../utils/prisma.js";
import { errorResponse } from "../libs/errorResponse.js";
import { successResponse } from "../libs/successResponse.js";

// Get all credit packages
export const getPackages = async (req, res) => {
  try {
    const packages = await prisma.creditPackage.findMany({
      orderBy: [
        { credit_type: 'asc' },
        { price: 'asc' }
      ],
    });

    return successResponse(res, "Credit packages retrieved successfully", 200, {
      packages,
    });
  } catch (error) {
    console.error("Get packages error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Get single credit package
export const getPackage = async (req, res) => {
  try {
    const { id } = req.params;

    const package_ = await prisma.creditPackage.findUnique({
      where: { id: parseInt(id) },
    });

    if (!package_) {
      return errorResponse(res, "Credit package not found", 404);
    }

    return successResponse(res, "Credit package retrieved successfully", 200, {
      package: package_,
    });
  } catch (error) {
    console.error("Get package error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Create new credit package
export const createPackage = async (req, res) => {
  try {
    const { name, credit_type, credits, price, description, is_active } = req.body;

    // Validasi input
    if (!name || !credit_type || !credits || !price) {
      return errorResponse(res, "Missing required fields", 400);
    }

    // Validasi credit_type
    if (!["AI_CHAT", "TTS"].includes(credit_type)) {
      return errorResponse(res, "Invalid credit type", 400);
    }

    const newPackage = await prisma.creditPackage.create({
      data: {
        name,
        credit_type,
        credits: parseInt(credits),
        price: parseInt(price),
        description,
        is_active: is_active ?? true,
      },
    });

    return successResponse(res, "Credit package created successfully", 201, {
      package: newPackage,
    });
  } catch (error) {
    console.error("Create package error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Update credit package
export const updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, credit_type, credits, price, description, is_active } = req.body;

    // Check if package exists
    const existingPackage = await prisma.creditPackage.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingPackage) {
      return errorResponse(res, "Credit package not found", 404);
    }

    // Validasi credit_type jika ada
    if (credit_type && !["AI_CHAT", "TTS"].includes(credit_type)) {
      return errorResponse(res, "Invalid credit type", 400);
    }

    const updatedPackage = await prisma.creditPackage.update({
      where: { id: parseInt(id) },
      data: {
        name: name ?? undefined,
        credit_type: credit_type ?? undefined,
        credits: credits ? parseInt(credits) : undefined,
        price: price ? parseInt(price) : undefined,
        description: description ?? undefined,
        is_active: is_active ?? undefined,
      },
    });

    return successResponse(res, "Credit package updated successfully", 200, {
      package: updatedPackage,
    });
  } catch (error) {
    console.error("Update package error:", error);
    return errorResponse(res, error.message, 500);
  }
};

// Delete credit package
export const deletePackage = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if package exists
    const existingPackage = await prisma.creditPackage.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingPackage) {
      return errorResponse(res, "Credit package not found", 404);
    }

    await prisma.creditPackage.delete({
      where: { id: parseInt(id) },
    });

    return successResponse(res, "Credit package deleted successfully", 200);
  } catch (error) {
    console.error("Delete package error:", error);
    return errorResponse(res, error.message, 500);
  }
};
