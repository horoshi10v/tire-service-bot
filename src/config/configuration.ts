export default () => ({
    port: Number(process.env.PORT ?? 3000),
    botToken: process.env.BOT_TOKEN,

    google: {
        sheetId: process.env.GOOGLE_SHEET_ID,
        serviceEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY,
    },
});
