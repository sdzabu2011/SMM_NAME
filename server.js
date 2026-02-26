const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- SOZLAMALAR ---
const BOT_TOKEN = '8604338226:AAHXdsB83nXjc8_YHITw70d8K2Epu1FeD8o';
const ADMIN_ID = '6735799833';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Ma'lumotlar bazasi
const db = new sqlite3.Database('./database.db');

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'smm_key_2024',
    resave: false,
    saveUninitialized: true
}));

// --- BAZA JADVALLARI ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, balance INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, service TEXT, link TEXT, qty INTEGER, price INTEGER, status TEXT DEFAULT 'kutilmoqda')`);
});

// --- YO'NALISHLAR (ROUTES) ---

// Asosiy sahifa (Login/Register)
app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login');
});

// Ro'yxatdan o'tish
app.post('/auth/register', (req, res) => {
    const { username, password } = req.body;
    db.run("INSERT INTO users (username, password, balance) VALUES (?, ?, 1000)", [username, password], (err) => {
        if (err) return res.send("Xato: Bu login band!");
        res.redirect('/');
    });
});

// Kirish
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, user) => {
        if (user) {
            req.session.user = user;
            res.redirect('/dashboard');
        } else {
            res.send("Xato: Login yoki parol noto'g'ri!");
        }
    });
});

// Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    
    db.get("SELECT balance FROM users WHERE id = ?", [req.session.user.id], (err, user) => {
        db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC", [req.session.user.id], (err, orders) => {
            res.render('dashboard', { user: req.session.user, balance: user.balance, orders });
        });
    });
});

// Buyurtma berish
app.post('/order/new', (req, res) => {
    const { service, link, qty } = req.body;
    const userId = req.session.user.id;
    const price = Math.ceil(qty * 0.2); // Har 1 dona uchun 0.2 Star

    db.get("SELECT balance FROM users WHERE id = ?", [userId], (err, user) => {
        if (user.balance >= price) {
            db.run("UPDATE users SET balance = balance - ? WHERE id = ?", [price, userId]);
            db.run("INSERT INTO orders (user_id, service, link, qty, price, status) VALUES (?, ?, ?, ?, ?, 'kutilmoqda')", 
            [userId, service, link, qty, price], function(err) {
                const orderId = this.lastID;
                
                // ADMINGA XABAR
                const msg = `🚀 YANGI BUYURTMA #${orderId}\n👤 Kimdan: ${req.session.user.username}\n📦 Xizmat: ${service}\n🔗 Link: ${link}\n🔢 Soni: ${qty}\n💰 Narxi: ${price} Star`;
                
                bot.sendMessage(ADMIN_ID, msg, {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "⏳ Jarayonda", callback_data: `st_jarayonda_${orderId}` },
                                { text: "✅ Bajarildi", callback_data: `st_bajarildi_${orderId}` }
                            ],
                            [
                                { text: "❌ Qisman", callback_data: `st_qisman_${orderId}` }
                            ]
                        ]
                    }
                });
                res.redirect('/dashboard');
            });
        } else {
            res.send("Mablag' yetarli emas!");
        }
    });
});

// --- BOT BOSHQARUVI ---
bot.on('callback_query', (query) => {
    const data = query.data.split('_');
    const newStatus = data[1];
    const orderId = data[2];

    db.run("UPDATE orders SET status = ? WHERE id = ?", [newStatus, orderId], (err) => {
        if (!err) {
            bot.answerCallbackQuery(query.id, { text: "Status yangilandi!" });
            bot.editMessageText(`✅ Buyurtma #${orderId} statusi "${newStatus}" ga o'zgartirildi.`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            });
        }
    });
});

app.listen(PORT, () => console.log(`Server ${PORT}-portda yonishga tayyor!`));