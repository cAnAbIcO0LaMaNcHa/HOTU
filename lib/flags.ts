/**
 * INTERRUPTORES DE ENTORNO.
 *
 * Se leen EN EL MOMENTO DE LA LLAMADA y no al cargar el módulo, igual que
 * limpiezaHabilitada() en lib/accounts-delete.ts. La razón es práctica: un valor
 * capturado al importar obliga a reiniciar para cambiarlo, y "reiniciá el server
 * y probá de nuevo" es cómo alguien termina creyendo que el interruptor no
 * funciona.
 */

/**
 * ============================================================
 * VENTA_ONLINE — LA VENTA ESTÁ APAGADA HASTA NUEVO AVISO
 * ============================================================
 *
 * APAGADO POR DEFECTO, y eso es lo que importa: si la variable falta, está mal
 * escrita, o alguien despliega un entorno nuevo sin configurarla, no se vende.
 * El default de un interruptor de plata es "no". Es el criterio inverso al de
 * LIMPIEZA_PRELANZAMIENTO solo en apariencia: los dos fallan hacia el lado
 * seguro.
 *
 * SE LLAMA VENTA_ONLINE Y NO VENTA_BOLETAS, a propósito. El carrito es uno solo
 * y mezcla boletas y merch —hay un tipo de orden 'mixed'—, y `createPendingOrder`
 * es el único camino para las dos. Un interruptor llamado VENTA_BOLETAS que
 * además apaga el merch es un nombre que miente, y un nombre que miente sobre lo
 * que apaga es peor que no tener interruptor: alguien lo va a prender creyendo
 * que solo habilita boletas.
 *
 * QUÉ APAGA, exactamente:
 *   - createPendingOrder se niega. Es el ÚNICO camino que una persona puede
 *     alcanzar desde la web para crear una orden — está medido: los otros dos
 *     INSERT INTO orders son /api/seed-test y /api/migrate, los dos detrás de
 *     MIGRATE_SECRET, más los scripts de prueba que no son alcanzables.
 *   - el botón de agregar entrada en cada evento
 *   - el botón de comprar en /tienda, que queda de catálogo
 *   - el ícono del carrito en el header y el cajón del carrito
 *
 * QUÉ NO APAGA, y por qué:
 *   - El CartProvider sigue montado. No es un descuido: site-header llama a
 *     useCart(), que LANZA sin provider, así que sacarlo dejaría la pantalla en
 *     blanco en todas las páginas del sitio. Queda inerte —sin botones que le
 *     agreguen nada, sin cajón que lo muestre— y aunque alguien tuviera items
 *     guardados de antes en localStorage, no hay forma de verlos ni de pagarlos.
 *   - /perfil/tiquetes y la verificación en la puerta. Las boletas que ya existen
 *     siguen siendo válidas: apagar la venta no invalida lo comprado.
 *   - markOrderPaid en /admin/pedidos. Sigue pudiendo cobrar a mano una orden que
 *     YA EXISTE. Apagar la venta impide crear órdenes nuevas, no abandonar las
 *     que quedaron a medias.
 *
 * NO SE BORRA NADA DE CÓDIGO. La venta vuelve cuando cada colectivo tenga su
 * pasarela y esté verificado, y eso es una pieza aparte —está propuesta en
 * PROGRESO.md—. Borrar el carrito ahora significaría reescribirlo después.
 */
export function ventaOnlineHabilitada(): boolean {
  return process.env.VENTA_ONLINE === "1";
}
