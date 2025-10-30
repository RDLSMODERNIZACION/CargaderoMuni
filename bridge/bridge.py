    from fastapi import FastAPI, Request
    import requests

    app = FastAPI()

    # Endpoint que recibirá los datos del PLC
    @app.post("/api/plc/di")
    async def receive_di(request: Request):
        data = await request.json()
        print("🔹 Recibido desde PLC:", data)

        # Reenvía el evento al backend Render
        try:
            r = requests.post("https://cargaderomuni.onrender.com/api/plc/di", json=data, timeout=5)
            print("➡️ Enviado al backend:", r.status_code)
        except Exception as e:
            print("❌ Error reenviando:", e)

        return {"ok": True}
