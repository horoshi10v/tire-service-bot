import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
    NODE_ENV: Joi.string()
        .valid('development', 'production', 'test')
        .default('development'),
    PORT: Joi.number().default(3000),

    BOT_TOKEN: Joi.string().required(),
    DATABASE_URL: Joi.string().required(),

    GOOGLE_SHEET_ID: Joi.string().required(),
    GOOGLE_SERVICE_ACCOUNT_EMAIL: Joi.string().required(),
    GOOGLE_PRIVATE_KEY: Joi.string().required(),

    // Mail configuration
    MAIL_HOST: Joi.string().optional(),
    MAIL_PORT: Joi.number().default(587),
    MAIL_SECURE: Joi.string().valid('true', 'false').default('false'),
    MAIL_USER: Joi.string().optional(),
    MAIL_PASSWORD: Joi.string().optional(),
    MAIL_REQUIRE_TLS: Joi.string().valid('true', 'false').default('true'),
    MAIL_DEFAULT_NAME: Joi.string().default('Tire Service'),
    MAIL_DEFAULT_EMAIL: Joi.string().email().optional(),
});
