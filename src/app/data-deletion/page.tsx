import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Eliminación de datos",
  robots: { index: true, follow: true },
};

const COMPANY = "Envasadoras Colombia";
const CONTACT_EMAIL = "lopezdu53@icloud.com";

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Instrucciones para la eliminación de datos"
      lastUpdated="24 de julio de 2026"
    >
      <p>
        En <strong>{COMPANY}</strong> respetamos tu derecho a la supresión de tus
        datos personales, conforme a la Ley 1581 de 2012 de Colombia y a las
        políticas de la Plataforma de WhatsApp Business de Meta.
      </p>

      <h2>Cómo solicitar la eliminación de tus datos</h2>
      <p>
        Para solicitar que eliminemos los datos personales asociados a tu número
        de WhatsApp o a tu contacto, envía un correo electrónico a{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> con la siguiente
        información:
      </p>
      <ul>
        <li>
          <strong>Asunto:</strong> &ldquo;Solicitud de eliminación de datos&rdquo;.
        </li>
        <li>Tu nombre completo.</li>
        <li>El número de teléfono de WhatsApp asociado a tus datos.</li>
        <li>
          Cualquier detalle adicional que nos ayude a identificar tu información
          (por ejemplo, tu correo o empresa).
        </li>
      </ul>

      <h2>Qué ocurre después</h2>
      <ul>
        <li>
          Confirmaremos la recepción de tu solicitud y verificaremos tu
          identidad.
        </li>
        <li>
          Eliminaremos los datos personales asociados a tu contacto y a tus
          conversaciones, salvo aquella información que debamos conservar por
          obligaciones legales o contractuales.
        </li>
        <li>
          Atenderemos tu solicitud en un plazo razonable, de acuerdo con la
          normativa aplicable.
        </li>
      </ul>

      <h2>Contacto</h2>
      <p>
        Si tienes dudas sobre este procedimiento, escríbenos a{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}
