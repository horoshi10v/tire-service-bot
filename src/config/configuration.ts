export default () => ({
    port: Number(process.env.PORT ?? 3000),
    botToken: process.env.BOT_TOKEN,

    google: {
        sheetId: process.env.GOOGLE_SHEET_ID,
        serviceEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY,
    },

    mail: {
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT ?? 587),
        secure: process.env.MAIL_SECURE === 'true',
        user: process.env.MAIL_USER,
        password: process.env.MAIL_PASSWORD,
        requireTls: process.env.MAIL_REQUIRE_TLS === 'true',
        defaultName: process.env.MAIL_DEFAULT_NAME ?? 'Tire Service',
        defaultEmail: process.env.MAIL_DEFAULT_EMAIL,
    },
});
