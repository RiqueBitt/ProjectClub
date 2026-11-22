import sys,time,os
from playwright.sync_api import sync_playwright
import frames
src,tag,half,size,out=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4]),sys.argv[5]
os.environ["HALF"]=str(half)
import importlib;importlib.reload(frames)
dst=f"web/_b_{tag}.swf";frames.build(src,1,dst,half=half)
with sync_playwright() as pw:
    b=pw.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox","--use-gl=swiftshader","--enable-unsafe-swiftshader"])
    pg=b.new_page(viewport={"width":size,"height":size})
    pg.goto(f"http://127.0.0.1:8765/index.html?f=_b_{tag}.swf&size={size}")
    pg.wait_for_function("window.READY||window.ERR",timeout=60000);time.sleep(1.0)
    pg.screenshot(path=out,omit_background=True);b.close()
os.remove(dst)
