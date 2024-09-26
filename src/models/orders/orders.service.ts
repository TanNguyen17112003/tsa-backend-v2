import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { $Enums } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetUserType } from 'src/types';

import { CreateAdminOrderDto, CreateStudentOrderDto } from './dtos/create.dto';
import { OrderQueryDto } from './dtos/query.dto';
import { OrderEntity } from './entity/order.entity';
import {
  createOrderStatusHistory,
  findExistingOrder,
  getLatestOrderStatus,
  validateUserForOrder,
} from './utils/order.util';

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrders(query: OrderQueryDto, user: GetUserType): Promise<OrderEntity[]> {
    const { skip, take, order, sortBy } = query;

    // Fetch orders based on the query parameters and user role
    const orders = await this.prisma.order.findMany({
      ...(skip ? { skip: +skip } : null),
      ...(take ? { take: +take } : null),
      ...(sortBy ? { orderBy: { [sortBy]: order || 'asc' } } : null),
      where:
        user.role === 'STUDENT'
          ? { studentId: user.id }
          : {
              adminId: user.id,
            },
    });

    // Fetch the latest order status for each order
    const ordersWithStatus = await Promise.all(
      orders.map(async (order) => {
        const latestStatus = await getLatestOrderStatus(this.prisma, order.id);

        return {
          ...order,
          latestStatus,
        };
      })
    );

    return ordersWithStatus;
  }

  async getOrder(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    const latestStatus = await getLatestOrderStatus(this.prisma, id);
    return {
      ...order,
      latestStatus,
    };
  }

  async createOrder(
    createOrderDto: CreateStudentOrderDto | CreateAdminOrderDto,
    user: GetUserType
  ) {
    const { checkCode, product, weight } = createOrderDto;

    if ('studentId' in createOrderDto) {
      validateUserForOrder(user, createOrderDto, 'STUDENT');

      const existingOrder = await findExistingOrder(this.prisma, checkCode, product, weight);

      if (existingOrder) {
        await this.prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            ...createOrderDto,
          },
        });
        await createOrderStatusHistory(this.prisma, existingOrder.id, 'ACCEPTED');
        return { message: 'Order updated and status set to ACCEPTED' };
      }

      const newOrder = await this.prisma.order.create({
        data: createOrderDto as CreateStudentOrderDto,
      });
      await createOrderStatusHistory(this.prisma, newOrder.id, 'PENDING');
      return { message: 'Order created and status set to PENDING' };
    } else if ('adminId' in createOrderDto) {
      validateUserForOrder(user, createOrderDto, 'ADMIN');

      const existingOrder = await findExistingOrder(this.prisma, checkCode, product, weight);

      if (existingOrder) {
        await this.prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            phone: (createOrderDto as CreateAdminOrderDto).phone,
          },
        });
        await createOrderStatusHistory(this.prisma, existingOrder.id, 'ACCEPTED');
        return { message: 'Order updated and status set to ACCEPTED' };
      }

      const newOrder = await this.prisma.order.create({
        data: createOrderDto as CreateAdminOrderDto,
      });
      await createOrderStatusHistory(this.prisma, newOrder.id, 'PENDING');
      return { message: 'Order created and status set to PENDING' };
    } else {
      throw new BadRequestException('Invalid order creation request');
    }
  }

  async updateOrderInfo(
    id: string,
    updateOrderDto: CreateStudentOrderDto | CreateAdminOrderDto,
    user: GetUserType
  ) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    const latestOrderStatus = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId: id },
      orderBy: { time: 'desc' },
    });
    if (!order) {
      throw new BadRequestException('Order not found');
    }

    validateUserForOrder(user, order, user.role);

    if (latestOrderStatus.status !== 'PENDING') {
      throw new UnauthorizedException('You can only update orders that are pending');
    }

    await this.prisma.order.update({
      where: { id },
      data: updateOrderDto,
    });
    return { message: 'Order updated' };
  }

  async updateStatus(id: string, status: $Enums.OrderStatus, _: GetUserType) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) {
      throw new BadRequestException('Order not found');
    }
    await createOrderStatusHistory(this.prisma, id, status);
  }

  async deleteOrder(id: string, user: GetUserType) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    const latestOrderStatus = await this.prisma.orderStatusHistory.findFirst({
      where: { orderId: id },
      orderBy: { time: 'desc' },
    });
    if (!order) {
      throw new BadRequestException('Order not found');
    }

    validateUserForOrder(user, order, user.role);

    if (
      user.role === 'STUDENT' &&
      latestOrderStatus.status !== 'REJECTED' &&
      latestOrderStatus.status !== 'PENDING'
    ) {
      throw new UnauthorizedException('You can only delete orders that are pending or rejected');
    }

    await this.prisma.order.delete({ where: { id } });
    return { message: 'Order deleted' };
  }
}
