import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function PrivacyPage() {
  useDocumentTitle("Конфиденциальность");
  const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL;
  const developerName = import.meta.env.VITE_DEVELOPER_NAME;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 leading-relaxed">
      <h1 className="mb-6 text-3xl font-bold">Конфиденциальность ФизЛаб 3D</h1>
      <p className="mb-4 text-sm text-muted">Редакция от 30 сентября 2026 года.</p>
      {developerName && <p className="mb-4">Владелец приложения и оператор данных: {developerName}.</p>}
      <p className="mb-4">Для личного аккаунта мы храним email, имя, фамилию, загруженное вами фото профиля, защищённые хеши пароля и резервного кода, активную сессию, решённые задачи и список тем, которые вы отметили изученными. Приложение также записывает события использования тем и случайный идентификатор установки для ограничения входа одним устройством.</p>
      <p className="mb-4">Данные нужны для входа, восстановления доступа, синхронизации прогресса и проверки подписки. Локальная копия прогресса хранится на устройстве; серверная копия — в базе приложения. Данные не продаются и не используются для рекламы. Для подтверждения адреса и восстановления доступа сервис Resend получает email и служебное письмо. Одноразовые коды хранятся на сервере в виде хешей и имеют ограниченный срок действия.</p>
      <p className="mb-4">Платежи обрабатывает Google Play. ФизЛаб не получает номер вашей карты. Для проверки и восстановления покупок используется RevenueCat: ему передаются случайный идентификатор аккаунта, сведения о покупке и технические данные, необходимые для работы подписок. Имя, фото и email не передаются в RevenueCat приложением. Срок действия подписки проверяется через сервер, поэтому для полного курса требуется подключение к интернету.</p>
      <p className="mb-4">Аккаунт и учебный прогресс хранятся до удаления аккаунта. В <Link to="/account/delete" className="text-accent underline">личном кабинете</Link> можно удалить профиль, прогресс, события и средства входа. Эта же страница доступна в браузере вне приложения. Войдите и подтвердите действие паролем; при необходимости сначала <Link to="/recover" className="text-accent underline">восстановите доступ</Link>.</p>
      <p className="mb-4">При удалении аккаунта сервер также ставит в очередь запрос на удаление профиля RevenueCat. До успешной обработки сохраняется только случайный идентификатор для повторной отправки запроса. Удаление аккаунта не отменяет подписку Google Play: отмените продление в <a className="text-accent underline" href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noreferrer">настройках подписок Google Play</a>. История платежей у Google обрабатывается по правилам Google.</p>
      {supportEmail && <p className="mb-4">Вопросы о данных и запросы на удаление: <a className="text-accent underline [overflow-wrap:anywhere]" href={`mailto:${supportEmail}`}>{supportEmail}</a>.</p>}
      <p className="text-sm text-muted"><Link className="text-accent underline" to="/terms">Условия подписки</Link></p>
    </div>
  );
}
