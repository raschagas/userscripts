"""Synthetic DOM contracts, not claims of live MakerWorld compatibility."""
import pytest
from conftest import inject, open_page, serve
from matchpattern import metadata, runs_on
from conftest import source

S = 'makerworld-filter.user.js'
URL = 'https://makerworld.com/en/models/search?q=holder'


def setup(make_ctx, **kw):
    ctx = make_ctx(**kw)
    serve(ctx, 'https://makerworld.com/**', 'makerworld.html')
    page = open_page(ctx, URL)
    inject(page, S)
    return page


def value(page, key, val):
    page.locator('#us-mw .pill').click() if not page.locator('#us-mw #panel').is_visible() else None
    page.locator('#us-mw #' + key).evaluate('(e,v)=>{e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));}', val)


def test_filters_unknown_and_persistence(make_ctx):
    p=setup(make_ctx)
    value(p,'likes',1000)
    assert p.locator('#two').evaluate('(e)=>e.classList.contains("us-mw-fail")')
    assert p.locator('#unknown .us-mw-dot').get_attribute('data-verdict')=='unknown'
    assert p.locator('#one .us-mw-dot').get_attribute('data-verdict')=='pass'
    value(p,'words','VASO')
    assert p.locator('.us-mw-fail').count()==2
    p.locator('#us-mw #hide').check()
    assert p.locator('.us-mw-hidden').count()==2
    p.reload();inject(p,S)
    assert p.locator('.us-mw-hidden').count()==2
    assert p.errors==[]


def test_manual_creator_restore_and_undo(make_ctx):
    p=setup(make_ctx)
    p.locator('#one summary').click();p.locator('#one button',has_text='Este criador').click()
    assert p.locator('.us-mw-hidden').count()==2
    p.locator('#us-mw .pill').click();p.locator('#us-mw #undo').click()
    assert p.locator('.us-mw-hidden').count()==0
    p.locator('#us-mw #close').click()
    p.locator('#one button',has_text='Este modelo').click()
    assert p.locator('.us-mw-hidden').count()==1
    p.locator('#us-mw .pill').click();p.locator('#us-mw summary').click()
    p.locator('#us-mw #search').fill('vaso')
    assert p.locator('#us-mw #restore button').count()==1
    p.locator('#us-mw #restore button').click()
    assert p.locator('.us-mw-hidden').count()==0


def test_recycled_and_ambiguous_cards(make_ctx):
    p=setup(make_ctx)
    value(p,'words','vaso')
    p.evaluate('''() => {const c=document.querySelector('#one'); c.querySelector('h3').textContent='Outro';c.querySelector('a').href='/en/models/900-other';}''')
    p.wait_for_timeout(400)
    assert p.locator('#one .us-mw-dot').count()==1
    assert not p.locator('#one').evaluate('(e)=>e.classList.contains("us-mw-fail")')
    p.evaluate('''() => {const a=document.createElement('a');a.href='/en/models/999-other';document.querySelector('#one').append(a);}''')
    p.wait_for_timeout(400)
    assert p.locator('#one .us-mw-dot').count()==0
    assert p.errors==[]


@pytest.mark.parametrize('mobile,dark',[(False,False),(False,True),(True,False),(True,True)])
def test_ui_geometry_cleanup(make_ctx,mobile,dark):
    p=setup(make_ctx,mobile=mobile,dark=dark)
    offset=p.evaluate('''()=>{const d=document.querySelector('#one .us-mw-dot').getBoundingClientRect(),i=document.querySelector('#one img').getBoundingClientRect();return [d.top-i.top,d.left-i.left]}''')
    assert offset==[12,12]
    p.locator('#us-mw .pill').click()
    panel=p.locator('#us-mw .panel').bounding_box()
    assert panel['x']>=0 and panel['x']+panel['width']<=p.viewport_size['width']
    p.keyboard.press('Escape');assert not p.locator('#us-mw .panel').is_visible()
    p.locator('#us-mw .pill').click();p.locator('#us-mw #off').click()
    assert p.locator('#us-mw,#us-mw-style,[data-us-mw],.us-mw-card').count()==0
    p.evaluate("document.querySelector('h3').textContent='Changed'");p.wait_for_timeout(1100)
    assert p.locator('#us-mw,[data-us-mw]').count()==0
    p.evaluate("window.__menu[0].f()")
    assert p.locator('#us-mw').count()==1
    assert p.errors==[]


def test_loader_three_batches_and_navigation(make_ctx):
    p=setup(make_ctx)
    value(p,'words','vaso\ncaixa\nsuporte')
    p.locator('#us-mw #hide').check()
    p.evaluate('''()=>{window.loads=0;const b=document.createElement('button');b.textContent='Load more';b.onclick=()=>{window.loads++;const c=document.createElement('article');c.className='js-design-card';c.innerHTML=`<a href='/en/models/${1000+window.loads}-vaso'><img src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E'><h3>Vaso novo</h3></a>`;document.querySelector('main').insertBefore(c,b);};document.querySelector('main').append(b);}''')
    p.wait_for_function('window.loads===3',timeout=12000)
    p.wait_for_timeout(2100)
    assert p.evaluate('window.loads')==3
    assert p.locator('#us-mw #continue').is_visible()
    p.locator('#us-mw #continue').click()
    p.wait_for_function('window.loads===4')
    p.locator('#us-mw #auto').uncheck()
    p.wait_for_timeout(1800);assert p.evaluate('window.loads')==4
    p.evaluate("history.pushState({},'', '/en/@42-maker')")
    p.wait_for_timeout(1300)
    assert not p.locator('#us-mw #continue').is_visible()


def test_loader_no_progress_pauses(make_ctx):
    p=setup(make_ctx)
    p.evaluate('''()=>{window.loads=0;const b=document.createElement('button');b.textContent='Load more';b.onclick=()=>window.loads++;document.querySelector('main').append(b);}''')
    p.wait_for_function('window.loads===1',timeout=5000)
    p.wait_for_timeout(14000)
    assert p.evaluate('window.loads')==1
    p.locator('#us-mw .pill').click()
    assert 'sem novos' in p.locator('#us-mw #load-status').inner_text()


def test_bad_storage_and_match(make_ctx):
    ctx=make_ctx();ctx.add_init_script("GM_getValue=()=>({words:22,likes:-4,models:[null,{},'x'],enabled:true})")
    serve(ctx,'https://makerworld.com/**','makerworld.html');p=open_page(ctx,URL);inject(p,S)
    assert p.locator('.us-mw-dot').count()==3 and p.errors==[]
    m=metadata(source(S))
    assert runs_on(m,URL)
    assert not runs_on(m,'https://evil.com/?makerworld.com')
    assert not runs_on(m,'https://makerworld.com.evil.com/en')


def test_loader_rejects_ambiguous_controls_and_disabled(make_ctx):
    p=setup(make_ctx)
    p.evaluate('''()=>{window.loads=0;for(let i=0;i<2;i++){const b=document.createElement('button');b.className='native-load';b.textContent='Load more';b.onclick=()=>window.loads++;document.querySelector('main').append(b);}}''')
    p.wait_for_timeout(2100);assert p.evaluate('window.loads')==0
    p.evaluate("document.querySelector('.native-load').remove();document.querySelector('.native-load').disabled=true")
    p.wait_for_timeout(1600);assert p.evaluate('window.loads')==0
    p.evaluate("document.querySelector('.native-load').disabled=false")
    p.wait_for_function('window.loads===1')
    p.locator('#us-mw .pill').click();p.locator('#us-mw #off').click()
    p.wait_for_timeout(1600);assert p.evaluate('window.loads')==1


def test_nested_model_anchor_controls_do_not_navigate(make_ctx):
    p=setup(make_ctx)
    p.evaluate('''()=>{const c=document.querySelector('#one'),a=c.querySelector('a');a.append(c.querySelector('.us-mw-actions'));}''')
    p.locator('#one summary').click()
    p.locator('#one button',has_text='Este modelo').click()
    assert p.url==URL
    assert p.locator('#one').evaluate('(e)=>e.classList.contains("us-mw-hidden")')
