# LIFEケアコネクト

LINE公式アカウントから高齢者本人へ安否確認通知を送り、ボタン返信をWebhookで受け取り、必要時にLIFFの管理画面をLINE内で開くためのプロトタイプです。

## できること

- LINE公式アカウントからボタン付き安否確認を送るためのサーバー処理
- 本人の「元気」「少し不調」「連絡希望」返信をWebhookで受付
- 未回答者の要対応エスカレーション
- 家族・ケアマネ・事業所の権限別ビュー
- 介護記録と訪問予定の管理画面
- LIFF SDKを読み込み、LINE内ブラウザ起動に対応できる画面構成

## 起動

Node.js 18以上で動きます。外部パッケージは不要です。

```powershell
node server.js
```

起動後、以下を開きます。

```text
http://127.0.0.1:4173/
```

## GitHubからNetlifyへ公開

このリポジトリはNetlifyにそのまま接続できます。

1. GitHubにこのフォルダをリポジトリとしてpushします。
2. Netlifyで「Add new site」からGitHubリポジトリを選びます。
3. Build commandは空欄で構いません。
4. Publish directoryは `public` を指定します。
5. Functions directoryは `netlify/functions` です。

`netlify.toml` に以下のルーティングを設定済みです。

```text
/api/*        -> Netlify Functions
/line/webhook -> Netlify Functions
```

Netlifyで公開後のURLが `https://example.netlify.app` の場合、LINE DevelopersのWebhook URLは以下です。

```text
https://example.netlify.app/line/webhook
```

LIFFアプリのエンドポイントURLは以下です。

```text
https://example.netlify.app/
```

## LINE連携設定

`.env.example` を参考に環境変数を設定します。

```powershell
$env:LINE_CHANNEL_ACCESS_TOKEN="..."
$env:LINE_CHANNEL_SECRET="..."
$env:LIFF_ID="..."
$env:PUBLIC_BASE_URL="https://example.com"
$env:PORT="4173"
node server.js
```

Netlifyでは、Site configuration の Environment variables に以下を設定します。

```text
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LIFF_ID
PUBLIC_BASE_URL
```

`PUBLIC_BASE_URL` はNetlifyの公開URLにします。

LINE Developers側では、Messaging APIチャネルのWebhook URLを以下にします。

```text
https://example.com/line/webhook
```

LIFFアプリのエンドポイントURLは以下のように設定します。

```text
https://example.com/
```

## 実運用化で必要なこと

- `data/store.json` の利用者ごとに実際の `lineUserId` を登録する
- HTTPS公開URLを用意する
- LINE DevelopersでWebhook利用を有効化する
- LIFF IDを発行して `LIFF_ID` に設定する
- 認証、権限、監査ログ、個人情報保護の設計を追加する
- Netlify Functions上のデモデータは永続DBではありません。本番ではSupabase、Firebase、Neon、Netlify Blobsなどに保存先を移します。
