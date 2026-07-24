import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Política de Privacidad",
  robots: { index: true, follow: true },
};

const COMPANY = "Envasadoras Colombia";
const CONTACT_EMAIL = "lopezdu53@icloud.com";

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidad" lastUpdated="24 de julio de 2026">
      <p>
        En <strong>{COMPANY}</strong> valoramos y respetamos tu privacidad. Esta
        Política de Privacidad describe cómo recopilamos, usamos, almacenamos y
        protegemos la información cuando utilizamos nuestra plataforma de gestión
        de relaciones con clientes (CRM) para WhatsApp, disponible en{" "}
        <strong>whatsapp.ventabot.cloud</strong> (la &ldquo;Plataforma&rdquo;).
      </p>
      <p>
        Actuamos como responsables del tratamiento de los datos personales de
        acuerdo con la Ley 1581 de 2012 y el Decreto 1377 de 2013 de la República
        de Colombia (Habeas Data), así como con las políticas de la Plataforma de
        WhatsApp Business de Meta.
      </p>

      <h2>1. Información que recopilamos</h2>
      <p>Recopilamos y tratamos la siguiente información:</p>
      <ul>
        <li>
          <strong>Datos de contacto de clientes:</strong> nombre, número de
          teléfono de WhatsApp, correo electrónico, empresa, número de
          identificación tributaria (NIT o cédula) y dirección.
        </li>
        <li>
          <strong>Contenido de las conversaciones:</strong> los mensajes
          intercambiados a través de WhatsApp, incluidos textos, imágenes,
          audios (notas de voz), documentos (por ejemplo el RUT) y tarjetas de
          contacto que los clientes comparten.
        </li>
        <li>
          <strong>Datos de gestión comercial:</strong> notas internas,
          etiquetas, oportunidades de negocio y estados asignados a cada
          conversación por nuestro equipo.
        </li>
        <li>
          <strong>Datos de la cuenta:</strong> información de las personas de
          nuestro equipo que usan la Plataforma (nombre, correo, rol).
        </li>
      </ul>

      <h2>2. Cómo usamos la información</h2>
      <p>Utilizamos la información recopilada para:</p>
      <ul>
        <li>Atender y responder las conversaciones de WhatsApp con nuestros clientes.</li>
        <li>Gestionar la relación comercial, cotizaciones y oportunidades de venta.</li>
        <li>Actualizar y mantener organizados los datos de contacto.</li>
        <li>
          Asistir a nuestro equipo mediante funciones de inteligencia artificial
          que ayudan a redactar respuestas y a organizar la información de la
          conversación.
        </li>
        <li>Mejorar la calidad de nuestra atención y de nuestros servicios.</li>
      </ul>

      <h2>3. WhatsApp y Meta Platforms</h2>
      <p>
        La Plataforma se integra con la API de WhatsApp Business de Meta
        Platforms, Inc. para enviar y recibir mensajes. El tratamiento de los
        mensajes a través de WhatsApp está adicionalmente sujeto a la{" "}
        <a href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
          Política de Privacidad de WhatsApp
        </a>{" "}
        y a las condiciones de Meta. No usamos los datos obtenidos de WhatsApp
        para fines distintos a la comunicación y gestión comercial descritas en
        esta política.
      </p>

      <h2>4. Inteligencia Artificial</h2>
      <p>
        Para asistir a nuestro equipo, el contenido de las conversaciones puede
        ser procesado por proveedores de modelos de inteligencia artificial con
        el único fin de redactar borradores de respuesta y estructurar los datos
        del cliente. Este procesamiento se realiza de forma segura y no se
        emplea para entrenar modelos de terceros.
      </p>

      <h2>5. Almacenamiento y seguridad</h2>
      <p>
        La información se almacena en infraestructura segura (proveedores de
        bases de datos y alojamiento). Aplicamos medidas técnicas y
        organizativas razonables para proteger los datos, incluido el cifrado de
        las credenciales sensibles. A pesar de nuestros esfuerzos, ningún sistema
        es completamente infalible, por lo que no podemos garantizar una
        seguridad absoluta.
      </p>

      <h2>6. Compartir información con terceros</h2>
      <p>
        <strong>No vendemos</strong> tus datos personales. Compartimos
        información únicamente con los proveedores necesarios para operar la
        Plataforma —como el proveedor de la API de WhatsApp (Meta), el proveedor
        de base de datos y alojamiento, y el proveedor de inteligencia
        artificial— y solo en la medida necesaria para prestar el servicio.
        También podremos divulgar información cuando la ley lo exija.
      </p>

      <h2>7. Conservación de los datos</h2>
      <p>
        Conservamos los datos personales durante el tiempo necesario para
        cumplir las finalidades descritas y las obligaciones legales,
        contractuales y comerciales aplicables. Cuando ya no sean necesarios,
        serán eliminados o anonimizados.
      </p>

      <h2>8. Tus derechos</h2>
      <p>
        De acuerdo con la Ley 1581 de 2012, como titular de los datos tienes
        derecho a conocer, actualizar, rectificar y suprimir tus datos
        personales, así como a revocar la autorización otorgada. Para ejercer
        estos derechos, escríbenos a{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>9. Eliminación de datos</h2>
      <p>
        Puedes solicitar la eliminación de tus datos en cualquier momento.
        Consulta el procedimiento en nuestra página de{" "}
        <a href="/data-deletion">Eliminación de datos</a>.
      </p>

      <h2>10. Menores de edad</h2>
      <p>
        La Plataforma está dirigida a la gestión comercial entre empresas y sus
        clientes, y no está destinada a menores de edad. No recopilamos
        intencionadamente datos de menores.
      </p>

      <h2>11. Cambios a esta política</h2>
      <p>
        Podemos actualizar esta Política de Privacidad ocasionalmente. La versión
        vigente será siempre la publicada en esta página, con su fecha de última
        actualización.
      </p>

      <h2>12. Contacto</h2>
      <p>
        Si tienes preguntas sobre esta Política de Privacidad o sobre el
        tratamiento de tus datos, contáctanos en{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
