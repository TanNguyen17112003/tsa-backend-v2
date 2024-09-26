import { UnauthorizedException } from '@nestjs/common';
import { $Enums } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetUserType } from 'src/types';

export const findExistingOrder = async (
  prisma: PrismaService,
  checkCode: string,
  product: string,
  weight: number
) => {
  return await prisma.order.findFirst({
    where: { checkCode, product, weight },
  });
};

export const createOrderStatusHistory = async (
  prisma: PrismaService,
  orderId: string,
  status: $Enums.OrderStatus,
  reason?: string
) => {
  await prisma.orderStatusHistory.create({
    data: {
      orderId,
      status,
      time: Math.floor(Date.now() / 1000).toString(),
      reason,
    },
  });
};

export const validateUserForOrder = (
  user: GetUserType,
  order: any,
  role: 'STUDENT' | 'ADMIN' | 'STAFF'
) => {
  if (role === 'STUDENT' && (user.role !== 'STUDENT' || user.id !== order.studentId)) {
    throw new UnauthorizedException();
  }

  if (role === 'ADMIN' && (user.role !== 'ADMIN' || user.id !== order.adminId)) {
    throw new UnauthorizedException();
  }
};

export const getLatestOrderStatus = async (prisma: PrismaService, orderId: string) => {
  const latestStatus = await prisma.orderStatusHistory.findFirst({
    where: { orderId },
    orderBy: { time: 'desc' },
  });

  return latestStatus ? latestStatus.status : null;
};
