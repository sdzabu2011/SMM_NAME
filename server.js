/**
 * SMM GOLD ACCESS - Enterprise Backend System
 * Muallif: Gemini AI Collaboration
 * Versiya: 2.0.0
 */

// 1. MODULLARNI CHAQIRISH
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 2. MA'LUMOTLAR BAZASI SOZLAMALARI (Supabase/PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:nameSMM_panel@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false },
    max: 20, // Bir vaqtning o'zida 20 ta ulanish
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// 3. TELEGRAM BOT SOZLAMALARI
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://smm-name.onrender.com';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 4. MIDDLEWARE (Xavfsizlik va samaradorlik)
app.use(helmet({ contentSecurityPolicy: false })); // Xavfsizlik sarlavhalari
app.use(compression()); // Trafikni siqish
app.use(morgan('combined')); // Loglarni yozish
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 5. SESSION BOSHQARUVI (Bazada saqlanadi)
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'gold_master_key_9999',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, secure: false } // 30 kun
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- TIZIMNING YURAGI (LOGIKA) ---

// A. BOT BUYRUQLARI
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🌟 **SMM GOLD PANEL** ga xush kelibsiz!\n\nPastdagi tugma orqali panelni oching va xizmatlardan foydalaning.", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 Panelni Ochish", web_app: { url: WEB_APP_URL } }]]
        }
    });
});

// B. AUTHENTICATION (Login/Register)
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (user.rows.length > 0 && user.rows[0].password === password) {
            req.session.userId = user.rows[0].id;
            return res.json({ success: true, redirect: '/dashboard' });
        }
        res.status(401).json({ success: false, message: "Username yoki parol xato!" });
    } catch (err) {
        res.status(500).json({ error: "Server xatosi" });
    }
});

// C. TELEGRAM BOG'LASH (Sync)
app.post('/api/sync-telegram', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Avval login qiling" });
    const { tg_data } = req.body; // Telegram WebApp.initDataUnsafe.user

    try {
        await pool.query(
            "UPDATE users SET tg_id = $1, tg_username = $2, first_name = $3 WHERE id = $4",
            [tg_data.id, tg_data.username, tg_data.first_name, req.session.userId]
        );
        res.json({ success: true, message: "Telegram muvaffaqiyatli bog'landi!" });
    } catch (err) {
        res.status(500).json({ error: "Bog'lashda xatolik" });
    }
});

// D. SMM BUYURTMA BERISH (Reseller API integratsiyasi)
app.post('/api/order/create', async (req, res) => {
    const { serviceId, link, quantity } = req.body;
    const userId = req.session.userId;

    if (!userId) return res.status(403).send("Unauthorized");

    try {
        const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
        const user = userResult.rows[0];

        // Narxni hisoblash (Masalan: 1000 ta uchun 700 Stars)
        const price = Math.ceil((quantity / 1000) * 700);

        if (user.balance < price) {
            return res.status(400).json({ success: false, message: "Mablag' yetarli emas!" });
        }

        // 1. Bazada balansni kamaytirish
        await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, userId]);

        // 2. SMM API-ga so'rov yuborish (Masalan: JustSMM yoki boshqa)
        // const apiRes = await axios.get(`https://smm-provider.com/api/v2?key=YOUR_KEY&action=add&service=${serviceId}&link=${link}&quantity=${quantity}`);
        const externalOrderId = Math.floor(Math.random() * 1000000); // Test uchun

        // 3. Buyurtmani bazaga yozish
        await pool.query(
            "INSERT INTO orders (user_id, service_id, link, quantity, price, external_id, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [userId, serviceId, link, quantity, price, externalOrderId, 'pending']
        );

        res.json({ success: true, orderId: externalOrderId });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Buyurtma berishda xatolik yuz berdi" });
    }
});

// E. DASHBOARD MA'LUMOTLARI
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    
    try {
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10", [req.session.userId]);
        const stats = await pool.query("SELECT COUNT(*) as total_orders, SUM(price) as total_spent FROM orders WHERE user_id = $1", [req.session.userId]);

        res.render('dashboard', {
            user: user.rows[0],
            orders: orders.rows,
            stats: stats.rows[0]
        });
    } catch (err) {
        res.send("Dashboard yuklashda xatolik");
    }
});

// F. STARS TO'LOV TIZIMI (Telegram Stars)
app.post('/api/deposit/stars', async (req, res) => {
    const { amount } = req.body;
    const userId = req.session.userId;
    const user = await pool.query("SELECT tg_id FROM users WHERE id = $1", [userId]);

    if (!user.rows[0].tg_id) return res.status(400).json({ error: "Avval Telegramni bog'lang!" });

    // Telegram Stars Invoice yuborish
    try {
        const invoiceUrl = await bot.createInvoiceLink(
            "Balansni to'ldirish",
            `${amount} Stars SMM balans uchun`,
            JSON.stringify({ userId, amount }),
            "", // provider token (Stars uchun bo'sh)
            "XTR", // Valyuta
            [{ label: "Stars", amount: amount }]
        );
        res.json({ success: true, url: invoiceUrl });
    } catch (e) {
        res.status(500).json({ error: "To'lov linki yaratib bo'lmadi" });
    }
});

// G. XATOLARNI BOSHQARISH (Global Error Handler)
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { message: "Tizimda kutilmagan xatolik yuz berdi" });
});
// ASOSIY SAHIFA (LOGIN)
app.get('/', (req, res) => {
    res.render('login'); // Bu views/login.ejs faylini ochadi
});
// 6. SERVERNI ISHGA TUSHIRISH
app.listen(PORT, () => {
    console.log(`
    =========================================
    🚀 SMM GOLD SERVER ISHLADI
    🌐 Port: ${PORT}
    📅 Vaqt: ${new Date().toLocaleString()}
    =========================================
    `);
});

