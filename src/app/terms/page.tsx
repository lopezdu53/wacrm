import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Condiciones del Servicio",
  robots: { index: true, follow: true },
};

const COMPANY = "Envasadoras Colombia";
const CONTACT_EMAIL = "lopezdu53@icloud.com";

export default function TermsPage() {
  return (
    <LegalPage
      title="Condiciones del Servicio"
      lastUpdated="24 de julio de 2026"
    >
      <p>
        Estas Condiciones del Servicio (las &ldquo;Condiciones&rdquo;) regulan el
        uso de la plataforma de gestión de relaciones con clientes (CRM) para
        WhatsApp operada por <strong>{COMPANY}</strong>, disponible en{" "}
        <strong>whatsapp.ventabot.cloud</strong> (la &ldquo;Plataforma&rdquo;).
        Al acceder o utilizar la Plataforma, aceptas estas Condiciones.
      </p>

      <h2>1. Descripción del servicio</h2>
      <p>
        La Plataforma permite gestionar conversaciones de WhatsApp, organizar
        contactos, administrar oportunidades de negocio y coordinar la atención
        de nuestro equipo. La Plataforma se integra con la API de WhatsApp
        Business de Meta.
      </p>

      <h2>2. Cuentas de usuario</h2>
      <p>
        El acceso a la Plataforma está restringido al personal autorizado de{" "}
        {COMPANY}. Los usuarios son responsables de mantener la confidencialidad
        de sus credenciales y de todas las actividades realizadas desde su
        cuenta. Debes notificarnos de inmediato ante cualquier uso no autorizado.
      </p>

      <h2>3. Uso aceptable</h2>
      <p>Al usar la Plataforma, te comprometes a:</p>
      <ul>
        <li>
          Cumplir las políticas de WhatsApp y Meta, incluidas sus políticas
          comerciales y de mensajería, y a no enviar mensajes no solicitados
          (spam).
        </li>
        <li>No utilizar la Plataforma para fines ilícitos, fraudulentos o engañosos.</li>
        <li>No transmitir contenido ofensivo, ilegal o que infrinja derechos de terceros.</li>
        <li>Respetar la privacidad y los derechos de los clientes y contactos.</li>
      </ul>

      <h2>4. Integración con WhatsApp y Meta</h2>
      <p>
        El uso de las funciones de mensajería está adicionalmente sujeto a los
        términos y políticas de Meta y de WhatsApp Business. El incumplimiento de
        dichas políticas puede resultar en la suspensión del número o del
        servicio por parte de Meta, sobre lo cual no tenemos control.
      </p>

      <h2>5. Propiedad intelectual</h2>
      <p>
        La Plataforma, su software y sus contenidos están protegidos por las
        leyes aplicables. No se concede ningún derecho de propiedad intelectual
        salvo el derecho limitado de uso descrito en estas Condiciones.
      </p>

      <h2>6. Disponibilidad del servicio</h2>
      <p>
        Procuramos mantener la Plataforma disponible y funcional, pero no
        garantizamos que el servicio sea ininterrumpido o esté libre de errores.
        Podremos realizar mantenimientos, actualizaciones o modificaciones en
        cualquier momento.
      </p>

      <h2>7. Limitación de responsabilidad</h2>
      <p>
        En la máxima medida permitida por la ley, {COMPANY} no será responsable
        por daños indirectos, incidentales o consecuentes derivados del uso o la
        imposibilidad de uso de la Plataforma, ni por interrupciones atribuibles
        a terceros proveedores (incluidos Meta y los servicios de alojamiento).
      </p>

      <h2>8. Terminación</h2>
      <p>
        Podemos suspender o dar por terminado el acceso a la Plataforma en caso
        de incumplimiento de estas Condiciones o cuando sea necesario para
        proteger el servicio o a nuestros usuarios.
      </p>

      <h2>9. Ley aplicable</h2>
      <p>
        Estas Condiciones se rigen por las leyes de la República de Colombia.
        Cualquier controversia se someterá a la jurisdicción de los tribunales
        competentes de Colombia.
      </p>

      <h2>10. Cambios en las Condiciones</h2>
      <p>
        Podemos actualizar estas Condiciones ocasionalmente. La versión vigente
        será siempre la publicada en esta página, con su fecha de última
        actualización. El uso continuado de la Plataforma implica la aceptación
        de los cambios.
      </p>

      <h2>11. Contacto</h2>
      <p>
        Para consultas sobre estas Condiciones, escríbenos a{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
