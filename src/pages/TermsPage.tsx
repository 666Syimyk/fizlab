import { Link } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { getManageSubscriptionsUrl } from "@/lib/billing";
import { FREE_DEMO_SLUGS } from "@/lib/access";

export function TermsPage() {
  useDocumentTitle("Условия использования и подписки");
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 leading-relaxed sm:px-6">
      <h1 className="mb-6 text-3xl font-bold">Условия использования и подписки</h1>
      <p className="mb-5 text-muted">ФизЛаб 3D — учебное приложение по общей физике. Материалы помогают в самостоятельном изучении и не гарантируют оценок или результатов экзаменов.</p>
      <h2 className="mb-2 mt-8 text-xl font-semibold">Бесплатный и полный доступ</h2>
      <p>{FREE_DEMO_SLUGS.size} ознакомительных тем доступны бесплатно. Аккаунт позволяет сохранять прогресс. Для остальных тем нужна действующая подписка «ФизЛаб Плюс». Регистрация сама по себе не открывает платные материалы.</p>
      <h2 className="mb-2 mt-8 text-xl font-semibold">Оплата и продление</h2>
      <p>В Android-приложении доступны подписки на месяц и год через Google Play, когда приём оплаты открыт. Цена, валюта, полный размер платежа и период показываются на экране тарифа и в окне Google Play до подтверждения. Годовая подписка оплачивается одним платежом за год. Подписка автоматически продлевается на следующий период, пока вы не отмените её.</p>
      <h2 className="mb-2 mt-8 text-xl font-semibold">Отмена и восстановление</h2>
      <p>Отменить будущее продление можно в <a href={getManageSubscriptionsUrl()} target="_blank" rel="noreferrer" className="text-accent underline">настройках подписок Google Play</a> до следующего продления. После отмены доступ сохраняется до конца оплаченного периода. Удаление приложения или аккаунта не отменяет списания в Google Play. Запрос возврата можно подать через Google Play; решение зависит от правил магазина и применимых требований.</p>
      <p className="mt-3">Для восстановления войдите в тот же аккаунт ФизЛаб и используйте тот же аккаунт Google Play, с которого была оформлена покупка, затем нажмите «Восстановить покупки» на <Link to="/subscription" className="text-accent underline">странице подписки</Link>. Доступ открывается после серверной проверки. Для проверки подписки требуется интернет.</p>
      <h2 className="mb-2 mt-8 text-xl font-semibold">Аккаунт и данные</h2>
      <p>Указывайте доступный вам email и подтвердите его перед оплатой. Сохраните резервный код восстановления в безопасном месте. Правила хранения данных и удаления аккаунта описаны в <Link to="/privacy" className="text-accent underline">политике конфиденциальности</Link>.</p>
    </div>
  );
}
