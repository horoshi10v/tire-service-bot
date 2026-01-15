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
});
