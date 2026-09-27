import { webview } from '@kit.ArkWeb';

const WORKBENCH_URL = 'https://fff.xmoj-script.uk/';

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  @State private loadError: boolean = false;

  build() {
    Stack() {
      Web({ src: WORKBENCH_URL, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .zoomAccess(true)
        .onPageEnd(() => {
          this.loadError = false;
        })
        .onErrorReceive(() => {
          this.loadError = true;
        })
        .width('100%')
        .height('100%')

      if (this.loadError) {
        Column({ space: 16 }) {
          Text('工作台加载失败，请检查网络后重试')
            .fontSize(16)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
          Button('重新加载')
            .onClick(() => {
              this.loadError = false;
              this.controller.loadUrl(WORKBENCH_URL);
            })
        }
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .width('100%')
        .height('100%')
        .backgroundColor('#17212b')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f4f6f8')
  }
}
