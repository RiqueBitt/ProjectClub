import sys,time,os
from playwright.sync_api import sync_playwright
import frames
src,color,out=sys.argv[1],sys.argv[2],sys.argv[3]
fr=[int(x) for x in sys.argv[4:]]
os.makedirs(out,exist_ok=True)
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox","--use-gl=swiftshader","--enable-unsafe-swiftshader"])
    pg=b.new_page(viewport={"width":800,"height":800})
    for n in fr:
        dst=f"web/_f_{color}_{n}.swf";frames.build(src,n,dst)
        pg.goto(f"http://127.0.0.1:8765/index.html?f=_f_{color}_{n}.swf")
        pg.wait_for_function("window.READY||window.ERR",timeout=30000);time.sleep(0.6)
        pg.screenshot(path=f"{out}/{color}_{n:02d}.png",omit_background=True);os.remove(dst)
    b.close()
