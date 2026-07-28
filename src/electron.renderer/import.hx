#if !macro
// Libs
import js.jquery.JQuery as J;
import dn.M;
import dn.Col;
import dn.Version;
import dn.Chrono;
import dn.legacy.Color as C;
import hxd.Key as K;
import Lang as L;
import dn.data.GetText;
import dn.data.LocaleString;
#if web
import web.WebElectronTools as ET;
import web.WebFS as NT;
import web.WebDialogs as ED;
import web.WebShell as SHELL;
import web.WebClipboard as CLIP;
#else
import dn.js.ElectronTools as ET;
import dn.js.NodeTools as NT;
import dn.js.ElectronDialogs as ED;
import electron.Shell as SHELL;
import electron.Clipboard as CLIP;
#end

// Misc
import page.Editor;
import misc.*;
import EditorTypes;
import ui.Notification as N;
import form.Input;
import App.LOG as LOG;
import AssetsDictionaries as D;
#end