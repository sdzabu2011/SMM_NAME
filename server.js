const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. SUPABASE BAZASIGA ULANISH VA TEKSHIRISH
// ==========================================
// DIQQAT: Bu yerda Direct Connection (To'g'ridan-to'g'ri 5432 porti) ishlatilmoqda
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:AvgClub2026@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

// Ulanish to'g'ri ishlashini avtomatik tekshiradigan qism (Log uchun)
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ BAZAGA ULANISHDA XATO! Parol xato yozilgan yoki server blokladi:', err.message);
    } else {
        console.log('✅ SUPABASE BAZASI BILAN ALOQA ZO\'R!');
        release();
    }
});

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==========================================
// 2. SESSIYA (KIRGAN ODAMNI ESLAB QOLISH)
// ==========================================
app.use(session({
    store: new pgSession({ pool: pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'gold_smm_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 kun saqlaydi
}));

// ==========================================
// 3. TELEGRAM BOT VA SAHIFALAR
// ==========================================
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🌟 **SMM GOLD PANEL** ga xush kelibsiz!", {
        reply_markup: {
            inline_keyboard: [[{ text: "🚀 Panelni Ochish", web_app: { url: process.env.WEB_APP_URL } }]]
        }
    });
});

app.get('/', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('login');
});

// ==========================================
// 4. REGISTRATSIYA VA LOGIN MANTIG'I
// ==========================================
app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const checkUser = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
        if (checkUser.rows.length > 0) return res.status(400).json({ error: "Bu logindagi foydalanuvchi mavjud!" });

        const newUser = await pool.query(
            "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id",
            [username, password]
        );
        req.session.userId = newUser.rows[0].id;
        res.json({ success: true });
    } catch (err) {
        console.error("Registratsiyada xato:", err); // Render'ga yozadi
        res.status(500).json({ error: "Registratsiyada xatolik" });
    }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await pool.query("SELECT * FROM users WHERE username = $1 AND password = $2", [username, password]);
        if (user.rows.length > 0) {
            req.session.userId = user.rows[0].id;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: "Login yoki parol xato!" });
        }
    } catch (err) {
        console.error("Loginda xato:", err);
        res.status(500).json({ error: "Loginda xatolik" });
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ==========================================
// 5. DASHBOARD VA ASOSIY FUNKSIYALAR
// ==========================================
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/');
    try {
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
        const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 10", [req.session.userId]);
        res.render('dashboard', { user: user.rows[0], orders: orders.rows });
    } catch (err) {
        console.error("Dashboard yuklashda xato:", err);
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

app.post('/api/order', async (req, res) => {
    if (!req.session.userId) return res.status(403).json({ error: "Ruxsat yo'q" });
    const { platform, service_type, link, quantity } = req.body;
    
    if (quantity < 10 || quantity > 25000) return res.status(400).json({ error: "Miqdor 10 dan 25,000 gacha bo'lishi kerak!" });

    const price = Math.floor(quantity / 10) * 100;

    try {
        const userResult = await pool.query("SELECT balance FROM users WHERE id = $1", [req.session.userId]);
        const currentBalance = userResult.rows[0].balance;

        if (currentBalance < price) return res.status(400).json({ error: "Balansingizda yetarli Stars yo'q!" });

        await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, req.session.userId]);
        await pool.query(
            "INSERT INTO orders (user_id, platform, service_type, link, quantity, price) VALUES ($1, $2, $3, $4, $5, $6)",
            [req.session.userId, platform, service_type, link, quantity, price]
        );

        res.json({ success: true, message: "Buyurtma qabul qilindi!" });
    } catch (err) {
        res.status(500).json({ error: "Buyurtmada xatolik" });
    }
});

app.listen(PORT, () => console.log(`🚀 Server ${PORT}-portda ishladi!`));
