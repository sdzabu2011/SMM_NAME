const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase Connection
const pool = new Pool({
    connectionString: 'postgresql://postgres:nameSMM_panel@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'tg_app_secret', resave: false, saveUninitialized: true }));

// Bot token xavfsizlik uchun (Validate initData)
const BOT_TOKEN = '8604338226:AAGKiNW9bk_zrHwOcWggwZZIh2MX0oSs5AI';

// MIDDLEWARE: Telegram ma'lumotlarini tekshirish
app.post('/auth/telegram', async (req, res) => {
    const { user } = req.body;
    // Bazada user bormi tekshiramiz, yo'q bo'lsa yaratamiz
    const checkUser = await pool.query("SELECT * FROM users WHERE username = $1", [user.username]);
    
    if (checkUser.rows.length === 0) {
        await pool.query("INSERT INTO users (username, password, balance) VALUES ($1, $2, 1000)", [user.username, 'tg_auth', 1000]);
    }
    
    req.session.user = { id: user.id, username: user.username };
    res.sendStatus(200);
});

app.get('/', (req, res) => res.render('login'));

app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    const userDb = await pool.query("SELECT * FROM users WHERE username = $1", [req.session.user.username]);
    const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1", [userDb.rows[0].id]);
    
    res.render('dashboard', { user: userDb.rows[0], orders: orders.rows });
});

app.post('/order/new', async (req, res) => {
    const { service, link, qty } = req.body;
    const price = Math.ceil(qty * 7);
    
    const user = await pool.query("SELECT id, balance FROM users WHERE username = $1", [req.session.user.username]);
    
    if (user.rows[0].balance >= price) {
        await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, user.rows[0].id]);
        await pool.query("INSERT INTO orders (user_id, service, link, qty, price, status) VALUES ($1, $2, $3, $4, $5, 'process')", 
            [user.rows[0].id, service, link, qty, price]);
        res.redirect('/dashboard');
    } else {
        res.send("No Stars!");
    }
});

app.listen(PORT, () => console.log(`Telegram Web App running on port ${PORT}`));

