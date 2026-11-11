from conftest import inject, open_page


def page_for(make_ctx, url, html):
    ctx = make_ctx()
    ctx.route('**/*', lambda r: r.fulfill(body=html, content_type='text/html'))
    return open_page(ctx, url)


def test_google_keeps_ai_and_cleans_dynamic_links(make_ctx):
    p = page_for(make_ctx, 'https://www.google.com.br/search?q=abc', '<div id="ai">Resposta IA</div><a id="link" href="/url?q=https%3A%2F%2Fexample.org%2Fx%3Fa%3D1" ping="/track">Resultado</a>')
    inject(p, 'google-clean.user.js')
    p.wait_for_function("document.querySelector('#link').href === 'https://example.org/x?a=1'")
    assert p.locator('#ai').is_visible()
    assert 'udm=' not in p.url
    assert p.locator('#link').get_attribute('ping') is None
    p.evaluate("document.body.insertAdjacentHTML('beforeend','<a id=bad href=\"/url?q=javascript%3Aalert(1)\">bad</a>')")
    p.wait_for_timeout(80)
    assert '/url?' in p.locator('#bad').get_attribute('href')
    p.evaluate('window.__menu[0].f()')
    p.wait_for_url('**udm=14')


def test_reddit_translation_removed_and_old_optional(make_ctx):
    p = page_for(make_ctx, 'https://www.reddit.com/r/test/', '<a id="post" href="https://www.reddit.com/r/test/comments/abc/?tl=pt-br&sort=new">Post</a><a id="external" href="https://example.org/?tl=x">external</a>')
    inject(p, 'reddit-clean.user.js')
    p.wait_for_function("!document.querySelector('#post').href.includes('tl=')")
    assert 'www.reddit.com' in p.url
    assert 'sort=new' in p.locator('#post').get_attribute('href')
    assert 'tl=x' in p.locator('#external').get_attribute('href')
    p.evaluate('window.__menu[0].f()')
    p.wait_for_url('https://old.reddit.com/**')


def test_reddit_location_translation_no_loop(make_ctx):
    p = page_for(make_ctx, 'https://www.reddit.com/r/test/?tl=pt-br&sort=new', '<p>Post</p>')
    inject(p, 'reddit-clean.user.js')
    p.wait_for_url('https://www.reddit.com/r/test/?sort=new')
    inject(p, 'reddit-clean.user.js')
    p.wait_for_timeout(100)
    assert p.url.endswith('?sort=new')


def test_youtube_only_inactivity_dialog(make_ctx):
    p = page_for(make_ctx, 'https://www.youtube.com/watch?v=abc', '<yt-confirm-dialog-renderer><p>Excluir vídeo?</p><div id="confirm-button"><button onclick="window.clicks=(window.clicks||0)+1">Confirmar</button></div></yt-confirm-dialog-renderer>')
    inject(p, 'youtube-continuar.user.js')
    p.wait_for_timeout(100)
    assert p.evaluate('window.clicks || 0') == 0
    p.locator('p').evaluate("e => e.textContent = 'Vídeo pausado. Continuar assistindo?'")
    p.wait_for_function('window.clicks === 1')
    p.wait_for_timeout(100)
    assert p.evaluate('window.clicks') == 1


def test_amazon_links_no_background_request(make_ctx):
    p = page_for(make_ctx, 'https://www.amazon.com.br/title/dp/B012345678/ref=abc?tag=tracking', '<main>Produto</main>')
    requests = []
    p.on('request', lambda r: requests.append(r.url))
    inject(p, 'amazon-links.user.js')
    p.wait_for_selector('#us-amazon-links')
    links = p.locator('#us-amazon-links a')
    assert links.nth(0).get_attribute('href') == 'https://www.amazon.com.br/dp/B012345678'
    assert links.nth(1).get_attribute('href') == 'https://keepa.com/#!product/12-B012345678'
    assert not requests
    p.evaluate("history.pushState({}, '', '/s?k=abc'); dispatchEvent(new PopStateEvent('popstate'))")
    p.wait_for_function("!document.querySelector('#us-amazon-links')")


def test_reddit_persisted_preference(make_ctx):
    ctx = make_ctx()
    ctx.route('**/*', lambda r: r.fulfill(body='<p>Post</p>', content_type='text/html'))
    p = open_page(ctx, 'https://old.reddit.com/r/test/')
    inject(p, 'reddit-clean.user.js')
    p.evaluate('window.__menu[0].f()')
    assert p.evaluate("GM_getValue('old_reddit', false)") is True
    p.reload()
    inject(p, 'reddit-clean.user.js')
    assert p.evaluate("window.__menu[0].t") == 'Usar old.reddit: ligado'


def test_youtube_with_unbloat_hidden_and_manual_pause(make_ctx):
    p = page_for(make_ctx, 'https://www.youtube.com/watch?v=abc', '<video></video><yt-confirm-dialog-renderer hidden><p>Continue watching?</p><div id="confirm-button"><button onclick="window.clicks=(window.clicks||0)+1">Yes</button></div></yt-confirm-dialog-renderer>')
    inject(p, 'unbloat.user.js')
    inject(p, 'youtube-continuar.user.js')
    p.wait_for_timeout(100)
    assert p.evaluate('window.clicks || 0') == 0
    assert p.locator('video').evaluate('e => e.paused')
    p.locator('yt-confirm-dialog-renderer').evaluate('e => e.hidden = false')
    p.wait_for_function('window.clicks === 1')


def test_amazon_product_navigation_and_invalid_asin(make_ctx):
    p = page_for(make_ctx, 'https://www.amazon.com.br/dp/B012345678', '<p>Product</p>')
    inject(p, 'amazon-links.user.js')
    p.wait_for_selector('#us-amazon-links')
    p.evaluate("history.pushState({}, '', '/gp/product/B987654321')")
    p.wait_for_function("document.querySelector('#us-amazon-links a').href.endsWith('B987654321')")
    p.evaluate("history.pushState({}, '', '/dp/BAD'); dispatchEvent(new PopStateEvent('popstate'))")
    p.wait_for_function("!document.querySelector('#us-amazon-links')")


def test_new_scripts_foreign_host_noop(make_ctx):
    p = page_for(make_ctx, 'https://example.org/search?q=x', '<a href="https://www.google.com/url?q=https://example.org/">Link</a>')
    for name in ['google-clean', 'reddit-clean', 'amazon-links', 'youtube-continuar']:
        inject(p, name + '.user.js')
    p.wait_for_timeout(100)
    assert p.locator('aside').count() == 0
    assert p.evaluate('window.__menu.length') == 0
    assert '/url?' in p.locator('a').get_attribute('href')
