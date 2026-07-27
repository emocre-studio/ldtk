package web;

class WebImagePicker {
	public static function pick(onPicked:(relPath:String)->Void) : Void {
		var input = js.Browser.document.createInputElement();
		input.type = "file";
		input.accept = "image/png,image/jpeg,image/gif";
		input.onchange = function(_) {
			if( input.files.length==0 ) return;
			var file = input.files.item(0);
			var reader = new js.html.FileReader();
			reader.onload = function(_) {
				var buf : js.lib.ArrayBuffer = cast reader.result;
				var bytes = haxe.io.Bytes.ofData(buf);
				ProjectTransport.uploadImage(
					bytes, file.name, file.type,
					(img) -> {
						var ext = img.name.lastIndexOf(".")>=0 ? img.name.substr(img.name.lastIndexOf(".")+1) : "png";
						var relPath = "images/" + img.id + "." + ext;
						WebFS.fs.writeBytes("/web/" + relPath, bytes);
						WebFS.fs.clearDirty(); // imagem já está no servidor
						onPicked(relPath);
					},
					(err) -> ui.Notification.error("Falha ao enviar a imagem: " + err)
				);
			}
			reader.readAsArrayBuffer(file);
		}
		input.click();
	}
}
