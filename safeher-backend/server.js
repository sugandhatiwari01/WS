require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/make-call", async (req, res) => {
    const { to } = req.body;
    try {
        const response = await fetch("https://voice-agent.edesy.in/api/v1/calls", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.EDESY_API_KEY}`,
            },
            body: JSON.stringify({
                phoneNumber: to,
                agentId: process.env.EDESY_AGENT_ID,
            }),
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// NEW — location SMS
app.post("/send-sms", async (req, res) => {
    const { phone, message } = req.body;
    try {
        const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${process.env.FAST2SMS_API_KEY}&route=q&message=${encodeURIComponent(message)}&language=english&flash=0&numbers=${phone}`;
        const response = await fetch(url, { method: "GET" });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(3000, () => console.log("Backend running on port 3000"));