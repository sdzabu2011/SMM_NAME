const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- SOZLAMALAR ---
const BOT_TOKEN = '8604338226:AAHXdsB83nXjc8_YHITw70d8K2Epu1FeD8o';
const ADMIN_ID = '6735799833';
const SUPABASE_URL = 'postgresql://postgres:nameSMM_panel@db.qyfaucykwcwzqyvdwspm.supabase.co:5432/postgres';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pool = new Pool({ 
    connectionString: SUPABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'gold_key_2026',
    resave: false,
    saveUninitialized: true
}));

// --- YO'NALISHLAR ---

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('login');
});

app.post('/auth/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        await pool.query("INSERT INTO users (username, password, balance) VALUES ($1, $2, 500)", [username, password]);
        res.send("<script>alert('Muvaffaqiyatli! Endi Login qiling.'); window.location='/';</script>");
    } catch (e) { res.send("Xato: Login band!"); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE username = $1 AND password = $2", [username, password]);
        if (result.rows.length > 0) {
            req.session.user = result.rows[0];
            res.redirect('/dashboard');
        } else { res.send("Login yoki parol xato!"); }
    } catch (e) { res.send("Xatolik!"); }
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/');
    try {
        const user = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.user.id]);
        const orders = await pool.query("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC", [req.session.user.id]);
        res.render('dashboard', { user: user.rows[0], orders: orders.rows });
    } catch (e) { res.send("Yuklashda xato!"); }
});

app.post('/order/new', async (req, res) => {
    const { service, link, qty } = req.body;
    // Narx mantiqi: 10 ta obunachi = 70 star (Siz aytgan 60-70 mantiqi)
    const price = Math.ceil(qty * 7); 

    try {
        const user = await pool.query("SELECT balance FROM users WHERE id = $1", [req.session.user.id]);
        if (user.rows[0].balance >= price) {
            await pool.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [price, req.session.user.id]);
            const order = await pool.query(
                "INSERT INTO orders (user_id, service, link, qty, price) VALUES ($1, $2, $3, $4, $5) RETURNING id", 
                [req.session.user.id, service, link, qty, price]
            );
            
            const orderId = order.rows[0].id;
            bot.sendMessage(ADMIN_ID, `✨ *YANGI BUYURTMA #${orderId}*\n👤 Mijoz: ${req.session.user.username}\n📦 Xizmat: ${service}\n🔗 Link: ${link}\n🔢 Miqdor: ${qty}\n💰 Narx: ${price} Star`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "⏳ Jarayonda", callback_data: `st_jarayonda_${orderId}` }, { text: "✅ Bajarildi", callback_data: `st_bajarildi_${orderId}` }],
                        [{ text: "❌ Qisman", callback_data: `st_qisman_${orderId}` }]
                    ]
                }
            });
            res.redirect('/dashboard');
        } else {
            res.send("<script>alert('Star yetarli emas!'); window.location='/dashboard';</script>");
        }
    } catch (e) { res.send("Xato yuz berdi!"); }
});

bot.on('callback_query', async (q) => {
    const [_, status, id] = q.data.split('_');
    try {
        await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
        bot.editMessageText(`✅ Buyurtma #${id} yangilandi: ${status.toUpperCase()}`, {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id
        });
    } catch (e) { console.log(e); }
});

app.listen(PORT, () => console.log("Server yondi!"));
