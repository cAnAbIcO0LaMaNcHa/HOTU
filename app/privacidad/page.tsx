import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Cómo HOTU trata tus datos personales, conforme a la Ley 1581 de 2012 (Habeas Data, Colombia).",
};

export default function PrivacidadPage() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-16 md:py-24">
      <span className="inline-flex border border-primary px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-primary">
        HABEAS DATA
      </span>
      <h1 className="mt-6 text-4xl font-bold leading-[0.95] md:text-5xl">Política de privacidad</h1>
      <p className="mt-4 font-mono text-xs text-muted-foreground">
        Última actualización: agosto de 2026. Conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013 de Colombia.
      </p>

      <div className="mt-10 flex flex-col gap-8 font-mono text-sm leading-relaxed text-foreground/90">
        <div>
          <h2 className="text-lg font-bold text-primary">1. Responsable del tratamiento</h2>
          <p className="mt-2">
            HOTU (House of the Unknown), con contacto en hotuhouseoftheunknow@gmail.com, es responsable del
            tratamiento de los datos personales que recolecta a través de este sitio.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold text-primary">2. Datos que recolectamos</h2>
          <p className="mt-2">
            Nombre, correo y foto de perfil (a través de tu inicio de sesión con Google), y de forma opcional:
            número de teléfono y número de cédula de ciudadanía (CC), cuando los agregás en tu perfil.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold text-primary">3. Finalidad</h2>
          <p className="mt-2">
            Usamos estos datos únicamente para: identificarte dentro del sitio, gestionar tus pedidos y tiquetes,
            contactarte sobre tus compras, y verificar tu identidad en la puerta de los eventos cuando sea
            necesario. No vendemos ni compartimos tus datos con terceros para fines publicitarios.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold text-primary">4. Cómo protegemos tus datos</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Todo el sitio funciona bajo conexión cifrada (HTTPS).</li>
            <li>Tu cédula se almacena cifrada, no en texto plano.</li>
            <li>Solo vos podés ver y editar tus propios datos; ninguna consulta expone datos de otros usuarios.</li>
            <li>Limitamos la frecuencia de cambios a tu perfil para prevenir abuso.</li>
            <li>Guardamos un registro interno de cuándo se modifica tu perfil, sin registrar los valores.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-bold text-primary">5. Tus derechos (Habeas Data)</h2>
          <p className="mt-2">
            Como titular de tus datos, tenés derecho a conocer, actualizar, rectificar y solicitar la supresión de
            tus datos personales, así como a revocar la autorización otorgada. Para ejercer estos derechos,
            escribinos a hotuhouseoftheunknow@gmail.com.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-bold text-primary">6. Consentimiento</h2>
          <p className="mt-2">
            Al agregar tu número de teléfono o cédula en tu perfil, y marcar la casilla de autorización, aceptás
            que HOTU trate esos datos conforme a esta política.
          </p>
        </div>
      </div>
    </section>
  );
}
