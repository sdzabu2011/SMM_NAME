const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// --- SOZLAMALAR ---
const BOT_TOKEN = '8604338226:AAGKiNW9bk_zrHwOcWggwZZIh2MX0oSs5AI'; 
const WEB_APP_URL = 'https://smm-name.onrender.com'; // Web App manzilingiz
const SUPABASE_URL = 'postgresql://postgres:nameSMM_panel@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pool = new Pool({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false } });

// --- TELEGRAM BOT TUGMASI (/start) ---
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "✨ SMM GOLD PANEL ga xush kelibsiz!\n\nPastdagi tugmani bosib tizimga kiring:", {
        reply_markup: {
            inline_keyboard: [[
                { text: "🚀 PANELNI OCHISH", web_app: { url: WEB_APP_URL } }
            ]]
        }
    });
});

// --- SERVER PAPKALARINI SOZLASH ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tg_app_secret', resave: false, saveUninitialized: true }));

// --- YO'NALISHLAR (ROUTES) ---
app.get('/', (req, res) => res.render('login'));

app.post('/auth/telegram', async (req, res) => {
    const { user } = req.body;
    if (!user) return res.sendStatus(400);
    
    try {
        const checkUser = await pool.query("SELECT * FROM users WHERE username = $1", [user.username]);
        if (checkUser.rows.length === 0) {
            await pool.query("INSERT INTO users (username, password, balance) VALUES ($1, $2, 1000)", [user.username, 'tg_auth', 1000]);
        }
        req.session.user = { id: user.id, username: user.username };
        res.sendStatus(200);
    } catch (e) {
        console.error(e);
        res.sendStatus(500);
    }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        const userDb = await pool.query("SELECT * FROM users WHERE username = $1", [req.session.user.username]);
        const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1", [userDb.rows[0].id]);
        res.render('dashboard', { user: userDb.rows[0], orders: orders.rows });
    } catch (e) { res.send("Xatolik yuz berdi"); }
});

app.post('/order/new', async (req, res) => {
    const { service, link, qty } = req.body;
    const price = Math.ceil(qty * 7);
    try {
        const user = await pool.query("SELECT id, balance FROM users WHERE username = $1", [req.session.user.username]);
        if (user.rows[0].balance >= price) {
            await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, user.rows[0].id]);
            await pool.query("INSERT INTO orders (user_id, service, link, qty, price, status) VALUES ($1, $2, $3, $4, $5, 'process')", 
                [user.rows[0].id, service, link, qty, price]);
            res.redirect('/dashboard');
        } else {
            res.send("No Stars!");
        }
    } catch(e) { res.send("Xato!"); }
});

app.listen(PORT, () => console.log(`Server ishladi: ${PORT}`));
