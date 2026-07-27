package web;

/**
	Substituto browser do dn.js.ElectronDialogs (aliased como ED em import.hx).
	O browser não expõe diálogos nativos de arquivo/pasta: estas chamadas avisam
	o usuário e NÃO invocam o callback (o fluxo simplesmente não prossegue).
	A exceção é a escolha de imagem, que tem caminho próprio via WebImagePicker.
**/
class WebDialogs {
	static function unavailable(what:String) {
		ui.Notification.error(what + " não está disponível no editor web.");
	}

	public static function openFile(?exts:Array<String>, ?defaultPath:String, ?cb:String->Void) {
		unavailable("Abrir arquivo");
	}

	public static function saveFileAs(?exts:Array<String>, ?defaultPath:String, ?cb:String->Void) {
		unavailable("Salvar como");
	}

	public static function openDir(?defaultPath:String, ?cb:String->Void) {
		unavailable("Escolher pasta");
	}
}
