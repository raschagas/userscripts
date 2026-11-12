"""Deal layouts observed on AliExpress homepage and Bundle Deals, 2026-11-12."""
import pytest
from conftest import inject, open_page

@pytest.mark.parametrize('mobile', [False, True])
@pytest.mark.parametrize('path', ['/ssr/300002660/Deals-HomePage', '/ssr/300000512/BundleDeals2'])
def test_deals_cards_and_lazy_insert(make_ctx, mobile, path):
    ctx = make_ctx(mobile=mobile)
    html = '''<style>.grid {display:flex} .card {width:180px} img {width:150px;height:150px}</style>
    <div class="grid">
      <a class="productContainer card" id="home" href="/item/1005001111111111.html"><img><div>Produto sem avaliação</div><div>R$4,99</div></a>
      <div class="card"><a id="bundle" class="prodContainer_newhash cards--card--x" href="/item/1005002222222222.html"><img><div>3,000+ vendido(s)</div><div>R$5,99</div></a></div>
      <a class="nnCard card" id="mobilebundle" href="/item/1005005555555555.html"><img><div>12 vendido(s)</div><div>3.1</div></a>
      <div role="link" data-product-ids="1005003333333333,1005004444444444" id="campaign"><img><div>Campanha</div></div>
      <a class="prodContainer_newhash" id="store" href="/store/1234567"><img>Loja</a>
    </div>'''
    ctx.route('https://pt.aliexpress.com/**', lambda r: r.fulfill(body=html, content_type='text/html'))
    page = open_page(ctx, 'https://pt.aliexpress.com' + path)
    inject(page, 'shop-filter.user.js')
    assert page.locator('#home .us-sf-dot').get_attribute('data-v') == 'unknown'
    assert page.locator('#bundle .us-sf-dot').get_attribute('data-v') == 'pass'
    assert '3.000' in page.locator('#bundle .us-sf-dot').inner_text()
    assert page.locator('#campaign .us-sf-dot, #store .us-sf-dot').count() == 0
    assert page.locator('#mobilebundle .us-sf-dot').get_attribute('data-v') == 'fail'
    assert page.locator('.us-sf-load-card').count() == 0
    page.evaluate('''() => {
      const c=document.querySelector('#bundle').parentElement.cloneNode(true);
      c.querySelector('a').id='lazy'; c.querySelector('.us-sf-dot').remove();
      c.querySelector('a').innerHTML='<img><div>12 vendido(s)</div><div>R$5,99</div>';
      document.querySelector('.grid').append(c);
    }''')
    page.wait_for_function("document.querySelector('#lazy .us-sf-dot')?.dataset.v === 'fail'")
    assert page.locator('#lazy').evaluate("e=>e.classList.contains('us-sf-dim')")
    assert page.locator('#bundle .us-sf-dot').count() == 1
    page.evaluate("document.getElementById('us-shop-filter').shadowRoot.querySelector('[data-k=hide]').click()")
    assert not page.locator('#mobilebundle').is_visible()
    assert page.locator('#bundle').is_visible()
    page.evaluate("document.getElementById('us-shop-filter').shadowRoot.querySelector('[data-k=enabled]').click()")
    assert page.locator('.us-sf-dot').count() == 0
    assert page.locator('#mobilebundle').is_visible()
    assert not page.errors
