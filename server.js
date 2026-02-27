const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. SUPABASE BAZASI
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:AvgClub2026@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// SIZNING GRUPPANGIZ ID SI (Shu yerga bot yuboradi)
// Agar ID ni bilmasangiz, gruppangizga botni qo'shib, @RawDataBot orqali ID ni biling (masalan: -10012345678)
const ADMIN_GROUP_ID = '-1003842819697'; // O'zingiznikiga almashtirasiz

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'gold_smm_secret',
    resave: false, saveUninitialized: false, cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// ==========================================
// TELEGRAM BOT BUYRUQLARI VA STARS TO'LOVI
// ==========================================
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🌟 **SMM GOLD PANEL** ga xush kelibsiz!", {
        reply_markup: { inline_keyboard: [[{ text: "🚀 Panelni Ochish", web_app: { url: process.env.WEB_APP_URL } }]] }
    });
});

// Stars Invoice yaratish API si
app.post('/api/buy-stars', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Avval login qiling" });
    const { amount } = req.body;
    
    try {
        const userRes = await pool.query("SELECT tg_id FROM users WHERE id = $1", [req.session.userId]);
        const tg_id = userRes.rows[0].tg_id;
        
        if (!tg_id) return res.status(400).json({ error: "Avval Telegramni bog'lang!" });

        const invoiceLink = await bot.createInvoiceLink(
            "Balansni to'ldirish",
            `SMM xizmatlari uchun ${amount} Stars xarid qilish.`,
            JSON.stringify({ userId: req.session.userId, amount: amount }),
            "", // Stars uchun provider token bo'sh qoladi
            "XTR", // Telegram Stars valyutasi
            [{ label: "Stars", amount: parseInt(amount) }]
        );
        res.json({ success: true, url: invoiceLink });
    } catch (err) {
        console.error("Invoice xatosi:", err);
        res.status(500).json({ error: "To'lov havolasini yaratib bo'lmadi" });
    }
});

// To'lovni tasdiqlash
bot.on('pre_checkout_query', (query) => {
    bot.answerPreCheckoutQuery(query.id, true);
});

bot.on('message', async (msg) => {
    if (msg.successful_payment) {
        const payload = JSON.parse(msg.successful_payment.invoice_payload);
        const { userId, amount } = payload;
        
        // Pulni bazaga qo'shish
        await pool.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [amount, userId]);
        bot.sendMessage(msg.chat.id, `✅ Tabriklaymiz! Balansingizga ${amount} ⭐️ Stars qo'shildi.`);
    }
});

// ==========================================
// SAHIFALAR VA ASOSIY API
// ==========================================
app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('login');
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        // Barcha buyurtmalarni tortib olish
        const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC", [req.session.userId]);
        res.render('dashboard', { user: user.rows[0], orders: orders.rows });
    } catch (err) {
        res.send("Xatolik yuz berdi");
    }
});

app.post('/api/sync-telegram', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Avval login qiling" });
    const { tg_id, tg_username } = req.body;
    try {
        await pool.query("UPDATE users SET tg_id = $1, tg_username = $2 WHERE id = $3", [tg_id, tg_username, req.session.userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Telegram bog'lashda xatolik" });
    }
});

// ==========================================
// BUYURTMA BERISH VA GRUPPAGA YUBORISH
// ==========================================
app.post('/api/order', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Ruxsat yo'q" });
    const { platform, service_type, link, quantity } = req.body;
    
    if (quantity < 10 || quantity > 25000) return res.status(400).json({ error: "Miqdor 10 dan 25,000 gacha bo'lishi kerak!" });

    const price = Math.floor(quantity / 10) * 100;

    try {
        const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        const user = userResult.rows[0];

        if (user.balance < price) return res.status(400).json({ error: "Balansingizda yetarli Stars yo'q!" });

        // Balansni ayirish va bazaga yozish ('Kutilmoqda' statusi bilan)
        await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, req.session.userId]);
        const newOrder = await pool.query(
            "INSERT INTO orders (user_id, platform, service_type, link, quantity, price, status) VALUES ($1, $2, $3, $4, $5, $6, 'Kutilmoqda') RETURNING id",
            [req.session.userId, platform, service_type, link, quantity, price]
        );

        const orderId = newOrder.rows[0].id;

        // GRUPPAGA XABAR YUBORISH
        const text = `🚨 <b>YANGI BUYURTMA #${orderId}</b>\n\n👤 Mijoz: @${user.tg_username || user.username}\n🌐 Tarmoq: ${platform}\n📦 Xizmat: ${service_type}\n🔢 Soni: ${quantity} ta\n💰 Narxi: ${price} ⭐️\n\n🔗 <b>Silka (Link):</b>\n${link}`;
        
        bot.sendMessage(ADMIN_GROUP_ID, text, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [{ text: "⏳ Jarayonda", callback_data: `status_Jarayonda_${orderId}` }],
                    [{ text: "✅ Bajarildi", callback_data: `status_Bajarildi_${orderId}` }],
                    [{ text: "❌ Bekor qilish", callback_data: `status_Bekor_${orderId}` }]
                ]
            }
        }).catch(err => console.error("Gruppaga yuborishda xato (Group ID to'g'rimi?):", err.message));

        res.json({ success: true, message: "Buyurtma qabul qilindi!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Buyurtmada xatolik" });
    }
});

// Gruppadagi tugmalar bosilganda (Statusni o'zgartirish)
bot.on('callback_query', async (query) => {
    const data = query.data;
    if (data.startsWith('status_')) {
        const parts = data.split('_');
        const yangiHolat = parts[1]; // Jarayonda, Bajarildi, Bekor
        const orderId = parts[2];

        try {
            await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [yangiHolat, orderId]);
            bot.answerCallbackQuery(query.id, { text: `Holat "${yangiHolat}" ga o'zgartirildi!` });
            
            // Gruppadagi xabarni ham o'zgartirish (Holati belgilandi deb)
            bot.editMessageReplyMarkup({
                inline_keyboard: [[{ text: `Holat: ${yangiHolat} 📌`, callback_data: "ignore" }]]
            }, { chat_id: query.message.chat.id, message_id: query.message.message_id });

        } catch (err) {
            console.error("Status o'zgartirishda xato:", err);
        }
    }
});

// Ro'yxatdan o'tish qismlari (eski holidek qoladi)
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const checkUser = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (checkUser.rows.length > 0) return res.status(400).json({ error: "Bu logindagi foydalanuvchi mavjud!" });
        const newUser = await pool.query("INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id", [username, password]);
        req.session.userId = newUser.rows[0].id;
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Xatolik" }); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await pool.query("SELECT * FROM users WHERE username = $1 AND password = $2", [username, password]);
        if (user.rows.length > 0) {
            req.session.userId = user.rows[0].id; res.json({ success: true });
        } else { res.status(401).json({ error: "Login yoki parol xato!" }); }
    } catch (err) { res.status(500).json({ error: "Xatolik" }); }
});

app.get('/auth/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(PORT, () => console.log(`🚀 Server ${PORT}-portda ishladi!`));

