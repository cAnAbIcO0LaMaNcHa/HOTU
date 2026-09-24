import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { cuentaBaneada, normalizeEmail, upsertAccount, verifyCredentials } from "@/lib/accounts";

/**
 * The full auth instance, for the Node runtime only.
 *
 * Google (from auth.config.ts) and Credentials coexist on purpose: Google
 * stays for everyone who already uses it, Credentials exists so accounts
 * can be created without it. user_profiles.auth_provider records which one
 * created a given account. middleware.ts deliberately does NOT import this
 * module — see auth.config.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!email || !password) return null;
        return await verifyCredentials(email, password);
      },
    }),
  ],
  callbacks: {
    /**
     * ============================================================
     * UNA CUENTA BANEADA NO TIENE SESIÓN. ACÁ, Y EN UN SOLO LADO.
     * ============================================================
     *
     * Hasta acá el ban se comprobaba SOLO en signIn, y con sesiones JWT
     * eso solo frena ingresos NUEVOS: una cuenta baneada con la cookie
     * abierta seguía publicando, editando y comprando hasta que la cookie
     * expirara. El ban era una puerta cerrada con la gente ya adentro.
     *
     * El callback jwt corre cada vez que se lee la sesión, así que
     * devolver null acá la borra de inmediato —páginas, rutas de API y
     * Server Actions incluidos—. Eso último importa: la compra pasa por
     * un Server Action, que el middleware no toca.
     *
     * Un solo punto en vez de sembrar el chequeo en los ~20 caminos de
     * escritura. La diferencia no es el trabajo: es que el camino nuevo
     * que alguien agregue el mes que viene queda cubierto sin que tenga
     * que acordarse, y el que se olvida de este tipo de chequeo no falla
     * ruidosamente — deja pasar.
     *
     * CUESTA UNA CONSULTA por lectura de sesión, y es la decisión tomada:
     * que un baneado siga adentro un rato es peor que la consulta.
     *
     * FALLA ABIERTO si la base no contesta, igual que el upsert de abajo
     * y por la misma razón: un corte que invalide todas las sesiones deja
     * a todo el mundo afuera —admins incluidos— justo cuando alguien
     * tiene que entrar a arreglarlo.
     */
    async jwt({ token }) {
      const email = typeof token?.email === "string" ? normalizeEmail(token.email) : null;
      if (!email) return token;

      /**
       * EL EMAIL DE LA SESIÓN QUEDA NORMALIZADO ACÁ, Y NO EN CADA USO.
       *
       * user_profiles.email se guarda siempre en minúsculas —upsertAccount
       * lo normaliza—, pero la sesión conservaba lo que devolviera el
       * proveedor. Con Google eso puede venir con mayúsculas, y entonces
       * session.user.email deja de coincidir carácter a carácter con la
       * fila de la cuenta.
       *
       * Hoy eso es un desajuste callado. Con los FK de orders y tickets
       * pasa a ser un checkout que revienta con foreign_key_violation en
       * el momento de crear la orden, para un usuario real que no hizo
       * nada raro: lo encontró el migration-reviewer mirando qué convertía
       * la migración en falla dura.
       *
       * Se arregla acá porque es el único lugar por el que pasan los dos
       * proveedores y del que sale session.user.email. Arreglarlo en cada
       * consumidor sería acordarse veinte veces.
       */
      token.email = email;
      try {
        if (await cuentaBaneada(email)) {
          console.warn("[auth] sesión invalidada por ban:", email);
          return null;
        }
      } catch (err) {
        console.error("[auth] no pude comprobar el ban de", email, err);
      }
      return token;
    },

    /**
     * Creates the user_profiles row on first sign-in, for both providers.
     * artist_likes.user_email is a foreign key to user_profiles(email), so
     * a session without this row breaks on the user's first like.
     *
     * A failure here is logged but does NOT block the sign-in. The upsert
     * needs the database to be up and the migration to be applied on
     * whatever branch this deploy points at, and neither is worth taking
     * the whole platform down for: refusing the sign-in would lock every
     * user out, admins included, exactly when someone needs to get in and
     * fix it. A like that fails is a much smaller blast radius than a login
     * that fails, and the logged error says where to look.
     */
    async signIn({ user, account }) {
      const email = user?.email ? normalizeEmail(user.email) : null;
      if (!email) return false;

      /**
       * EL BAN SE APLICA ACÁ, Y SOLO ACÁ.
       *
       * Es el único punto por el que pasan LOS DOS proveedores. Ponerlo
       * en verifyCredentials habría dejado Google abierto, y una cuenta
       * baneada que igual puede entrar por el otro botón no está
       * baneada.
       *
       * Va ANTES del upsert: una cuenta baneada no tiene por qué seguir
       * refrescando su nombre y su foto en cada intento.
       *
       * FALLA ABIERTO si la base no contesta, igual que el upsert de
       * abajo y por la misma razón que dice su comentario: si un corte
       * de base negara todos los ingresos, quedaría afuera todo el
       * mundo —los admins incluidos— justo cuando alguien tiene que
       * entrar a arreglarlo. Un baneado que entra durante un corte es un
       * radio de daño muchísimo menor que la plataforma entera cerrada,
       * y el error queda logueado diciendo dónde mirar.
       */
      try {
        if (await cuentaBaneada(email)) {
          console.warn("[auth] intento de ingreso de una cuenta baneada:", email);
          return false;
        }
      } catch (err) {
        console.error("[auth] no pude comprobar el ban de", email, err);
      }

      try {
        await upsertAccount({
          email,
          displayName: user.name ?? null,
          avatarUrl: user.image ?? null,
          provider: account?.provider === "credentials" ? "credentials" : "google",
        });
      } catch (err) {
        console.error("[auth] could not upsert user_profiles for", email, err);
      }
      return true;
    },
  },
});
