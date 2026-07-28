# BU-Burbujas: pedidos, anticipo Mercado Pago y agentes IA

## Incluido
- Formulario de pedido en la página.
- Anticipo seleccionable de **$100 o $200 MXN**.
- Checkout Pro de Mercado Pago.
- Folio web automático.
- Webhook que consulta el pago directamente en Mercado Pago.
- Panel de pedidos en `/admin.html`.
- Estados: Nuevo, En proceso, Listo, Entregado y Cancelado.
- Agentes de IA opcionales.
- Copia de referencia del sistema actual en `/sistema-lavanderia-actual.html`.

## Configuración local
1. Instala Node.js 18 o posterior.
2. Copia `.env.example` como `.env`.
3. Coloca el **nuevo Access Token** de Mercado Pago en `MP_ACCESS_TOKEN`.
4. Cambia `ADMIN_PASSWORD`.
5. Ejecuta:

```bash
npm install
npm start
```

6. Abre:
- Página: `http://localhost:3000`
- Panel: `http://localhost:3000/admin.html`
- Estado técnico: `http://localhost:3000/api/salud`

## Para publicar
Configura estas variables privadas en el hospedaje:
- `PUBLIC_BASE_URL`: URL HTTPS final, sin diagonal al final.
- `MP_ACCESS_TOKEN`: Access Token de prueba o producción.
- `MP_USE_SANDBOX`: `true` durante pruebas y `false` al cobrar realmente.
- `ADMIN_PASSWORD`: contraseña fuerte.
- `OPENAI_API_KEY`: opcional.

En Mercado Pago Developers configura el webhook de **Pagos** hacia:

```text
https://TU-DOMINIO/api/mercadopago/webhook
```

## Seguridad
- Nunca pegues el Access Token en el HTML.
- No subas `.env` a GitHub.
- El token compartido anteriormente debe permanecer renovado/revocado.
- Antes de producción prueba pagos aprobados, pendientes y rechazados.
- Para operación multi-sucursal real se recomienda migrar `data/orders.json` a una base de datos administrada.


## Estructura para GitHub desde iPhone
Todos los archivos de este paquete van en la raíz del repositorio. No hay que crear carpetas `public` ni `data`.
