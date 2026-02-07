import { HttpException, HttpStatus } from '@nestjs/common';

export class OrderNotFoundException extends HttpException {
    constructor(publicId?: number) {
        super(
            publicId
                ? `Замовлення #${publicId} не знайдено`
                : 'Замовлення не знайдено',
            HttpStatus.NOT_FOUND
        );
    }
}

export class OrderAlreadyDoneException extends HttpException {
    constructor(publicId: number) {
        super(`Замовлення #${publicId} вже виконано`, HttpStatus.BAD_REQUEST);
    }
}

export class InvalidStatusTransitionException extends HttpException {
    constructor(from: string, to: string) {
        super(
            `Неможлива зміна статусу: ${from} → ${to}`,
            HttpStatus.BAD_REQUEST
        );
    }
}

export class InsufficientPermissionsException extends HttpException {
    constructor(message = 'Недостатньо прав доступу') {
        super(message, HttpStatus.FORBIDDEN);
    }
}

export class UserNotActiveException extends HttpException {
    constructor() {
        super('Користувач неактивний', HttpStatus.FORBIDDEN);
    }
}

export class ValidationException extends HttpException {
    constructor(message: string) {
        super(message, HttpStatus.BAD_REQUEST);
    }
}
