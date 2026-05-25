import { useNavigate, Link } from 'react-router-dom';
import { FMT_GBP as FMT } from '../lib/currency';
import { useShopCart } from '../context/ShopCartContext';
import './shopCartPremium.css';

function BackArrow() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15.5 18.5L8.5 12l7-7.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ShopCartPage() {
  const navigate = useNavigate();
  const { items, updateQty, subtotal } = useShopCart();
  const itemCount = items.reduce((n, l) => n + l.qty, 0);

  return (
    <div className="crt-page" role="main" aria-label="Your cart">
      <header className="crt-nav">
        <button type="button" className="crt-nav__back" onClick={() => navigate(-1)} aria-label="Back">
          <BackArrow />
        </button>
        <h1 className="crt-nav__title">Cart</h1>
        <span className="crt-nav__meta" aria-live="polite">
          {itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : ''}
        </span>
      </header>

      <div className="crt-scroll">
        {items.length === 0 ? (
          <div className="crt-empty">
            <p className="crt-empty__icon" aria-hidden>
              🛒
            </p>
            <h2 className="crt-empty__title">Your cart is empty</h2>
            <p className="crt-empty__sub">Browse shops and add products to get started.</p>
            <Link to="/shops" className="crt-empty__btn">
              Browse shops
            </Link>
          </div>
        ) : (
          <>
            <div className="crt-items">
              {items.map((l) => (
                <article key={l.id} className="crt-item">
                  {l.imageUrl ? (
                    <img className="crt-item__thumb" src={l.imageUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <div className="crt-item__ph" aria-hidden>
                      🛒
                    </div>
                  )}
                  <div className="crt-item__main">
                    <h2 className="crt-item__name">{l.name}</h2>
                    <p className="crt-item__shop">{l.shopName}</p>
                    <p className="crt-item__unit">{FMT.format(l.price)} each</p>
                  </div>
                  <p className="crt-item__price">{FMT.format(l.price * l.qty)}</p>
                  <div className="crt-item__qty" aria-label={`Quantity ${l.qty}`}>
                    <button
                      type="button"
                      className="crt-item__qtyBtn"
                      onClick={() => updateQty(l.id, -1)}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="crt-item__qtyVal">{l.qty}</span>
                    <button
                      type="button"
                      className="crt-item__qtyBtn"
                      onClick={() => updateQty(l.id, 1)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <section className="crt-summary" aria-label="Order summary">
              <div className="crt-summary__row">
                <span>Items ({itemCount})</span>
                <span>{FMT.format(subtotal)}</span>
              </div>
              <div className="crt-summary__row crt-summary__row--total">
                <span>Subtotal</span>
                <span>{FMT.format(subtotal)}</span>
              </div>
            </section>

            <Link to="/shops" className="crt-continue">
              Continue shopping
            </Link>
          </>
        )}
      </div>

      {items.length > 0 ? (
        <div className="crt-footer">
          <button type="button" className="crt-checkout" onClick={() => navigate('/shop/checkout')}>
            Checkout · {FMT.format(subtotal)}
          </button>
        </div>
      ) : null}
    </div>
  );
}
