import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import OpenAI from "openai";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ordersPath = path.join(__dirname, "data", "orders.json");
const baseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");

app.use(express.json({ limit: "50kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

function readOrders(){
  try { return JSON.parse(fs.readFileSync(ordersPath, "utf8")); }
  catch { return []; }
}
function writeOrders(orders){
  const temp = ordersPath + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(orders, null, 2));
  fs.renameSync(temp, ordersPath);
}
function clean(value, max=150){ return String(value ?? "").trim().slice(0,max); }
function newOrderId(){
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  return `WEB-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
async function mpRequest(url, options={}){
  const token = process.env.MP_ACCESS_TOKEN;
  if(!token) throw new Error("Mercado Pago no está configurado.");
  const response = await fetch(`https://api.mercadopago.com${url}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) {
    console.error("Mercado Pago:", response.status, data);
    throw new Error(data.message || data.error || "Error de Mercado Pago.");
  }
  return data;
}

app.post("/api/orders/checkout", async (req,res)=>{
  try{
    const deposit = Number(req.body?.deposit);
    if(![100,200].includes(deposit)) return res.status(400).json({error:"Selecciona un anticipo válido."});

    const order = {
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      customerName: clean(req.body?.customerName,100),
      customerPhone: clean(req.body?.customerPhone,20),
      customerEmail: clean(req.body?.customerEmail,120),
      branch: clean(req.body?.branch,50),
      service: clean(req.body?.service,80),
      estimatedQty: clean(req.body?.estimatedQty,80),
      delivery: clean(req.body?.delivery,50),
      zone: clean(req.body?.zone,100),
      notes: clean(req.body?.notes,500),
      deposit,
      currency: "MXN",
      paymentStatus: "created",
      paymentId: null,
      preferenceId: null,
      orderStatus: "Nuevo",
      source: "website"
    };
    if(!order.customerName || !order.customerPhone || !order.customerEmail || !order.branch || !order.service || !order.estimatedQty){
      return res.status(400).json({error:"Completa los datos obligatorios."});
    }

    const preference = await mpRequest("/checkout/preferences", {
      method:"POST",
      body:JSON.stringify({
        items:[{
          id:order.id,
          title:`Anticipo lavandería ${order.id}`,
          description:`${order.service} · ${order.branch}`,
          quantity:1,
          currency_id:"MXN",
          unit_price:deposit
        }],
        payer:{
          name:order.customerName,
          email:order.customerEmail,
          phone:{number:order.customerPhone}
        },
        external_reference:order.id,
        back_urls:{
          success:`${baseUrl}/?payment=success&order=${encodeURIComponent(order.id)}#pedido`,
          pending:`${baseUrl}/?payment=pending&order=${encodeURIComponent(order.id)}#pedido`,
          failure:`${baseUrl}/?payment=failure&order=${encodeURIComponent(order.id)}#pedido`
        },
        auto_return:"approved",
        notification_url:`${baseUrl}/api/mercadopago/webhook`,
        metadata:{
          order_id:order.id,
          branch:order.branch,
          service:order.service
        }
      })
    });

    order.preferenceId = preference.id;
    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);

    res.json({
      orderId:order.id,
      checkoutUrl: process.env.MP_USE_SANDBOX === "true"
        ? (preference.sandbox_init_point || preference.init_point)
        : preference.init_point
    });
  }catch(error){
    console.error(error);
    res.status(500).json({error:error.message || "No se pudo iniciar el pago."});
  }
});

app.post("/api/mercadopago/webhook", async (req,res)=>{
  res.sendStatus(200);
  try{
    const type = req.query.type || req.body?.type;
    const paymentId = req.query["data.id"] || req.body?.data?.id;
    if(type !== "payment" || !paymentId) return;

    // Se consulta directamente a Mercado Pago; así no se confía solo en el contenido recibido.
    const payment = await mpRequest(`/v1/payments/${encodeURIComponent(paymentId)}`);
    const orderId = payment.external_reference || payment.metadata?.order_id;
    if(!orderId) return;

    const orders = readOrders();
    const index = orders.findIndex(o=>o.id===orderId);
    if(index < 0) return;
    const expected = Number(orders[index].deposit);
    if(Number(payment.transaction_amount) !== expected || payment.currency_id !== "MXN") return;

    orders[index].paymentId = String(payment.id);
    orders[index].paymentStatus = payment.status;
    orders[index].paymentStatusDetail = payment.status_detail;
    orders[index].paymentUpdatedAt = new Date().toISOString();
    writeOrders(orders);
  }catch(error){ console.error("Webhook MP:", error); }
});

function requireAdmin(req,res,next){
  const expected = process.env.ADMIN_PASSWORD;
  const received = req.get("x-admin-key");
  if(!expected || !received || received !== expected) return res.status(401).json({error:"No autorizado"});
  next();
}
app.get("/api/admin/orders", requireAdmin, (_req,res)=>res.json(readOrders()));
app.patch("/api/admin/orders/:id", requireAdmin, (req,res)=>{
  const allowed = ["Nuevo","En proceso","Listo","Entregado","Cancelado"];
  if(!allowed.includes(req.body?.orderStatus)) return res.status(400).json({error:"Estado inválido"});
  const orders=readOrders();
  const i=orders.findIndex(o=>o.id===req.params.id);
  if(i<0) return res.status(404).json({error:"Pedido no encontrado"});
  orders[i].orderStatus=req.body.orderStatus;
  orders[i].updatedAt=new Date().toISOString();
  writeOrders(orders);
  res.json(orders[i]);
});

// ===== Agentes IA =====
const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;
const businessFacts = `
Negocio: Lavandería BU-Burbujas, Los Cabos, B.C.S.
WhatsApp: 624 355 8991.
Sucursales: Zacatal, Vista Hermosa y Villas de Cortez.
Horario: 7:30 AM a 8:30 PM. Cerrado los martes.
Clientes: particulares, hoteles, restaurantes, Airbnb, spas, gimnasios y empresas.
Anticipos web disponibles: $100 o $200 MXN. El total final se confirma al recibir y revisar las prendas.
No inventes precios, cobertura, tiempos ni disponibilidad.
`;
const agentInstructions = {
 atencion:"Responde dudas generales y dirige a WhatsApp para confirmar pedidos.",
 cotizacion:"Recopila prendas, cantidad, frecuencia, zona y modalidad. No inventes precio final.",
 sucursales:"Orienta entre Zacatal, Vista Hermosa y Villas de Cortez."
};
app.post("/api/agente", async(req,res)=>{
 try{
  if(!client) return res.status(503).json({error:"La IA todavía no está configurada."});
  const agent=clean(req.body?.agent,30) || "atencion";
  const message=clean(req.body?.message,1500);
  if(!message) return res.status(400).json({error:"Escribe un mensaje."});
  const response=await client.responses.create({
   model:process.env.OPENAI_MODEL || "gpt-5",
   instructions:`${businessFacts}\n${agentInstructions[agent]||agentInstructions.atencion}\nResponde en español de México, breve y cordial.`,
   input:message,
   max_output_tokens:350
  });
  res.json({reply:response.output_text?.trim() || "No pude responder."});
 }catch(error){console.error(error);res.status(500).json({error:"No fue posible responder."})}
});

app.get("/api/salud",(_req,res)=>res.json({
 ok:true,
 mercadoPagoConfigurado:Boolean(process.env.MP_ACCESS_TOKEN),
 iaConfigurada:Boolean(process.env.OPENAI_API_KEY)
}));
app.get("*",(_req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(port,()=>console.log(`BU-Burbujas: ${baseUrl}`));
