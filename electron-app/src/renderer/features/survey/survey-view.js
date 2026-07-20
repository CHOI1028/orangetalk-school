/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* ═══════════════════════════════════════
   SURVEY MODULE + 가정통신문 PDF 캔버스 에디터
   ═══════════════════════════════════════ */
/* ES Module */
import { escHtml, toDateStr, closeModalGracefully } from '../../core/helpers.js';
import { bus } from '../../core/event-bus.js';
import { openClockPicker } from '../emergency/emergency-view.js';
import { switchView } from '../shell/view-router.js';
import { S } from '../../core/app-state.js';
import { _magicSwitchSub } from '../planner/planner-view.js';

/* 학년도는 3월 1일 시작(달력 연도 아님). 요보호 '전년도' 판정도 학년도 기준. (사용자 지시 2026-06-19) */
function _academicYear(){
  const n=new Date();
  return n.getMonth()>=2?n.getFullYear():n.getFullYear()-1;
}

const svInitialized=false;
let svWizardSelectedGrades=[];
let svWizardSelectedStudents={};

/* ═══ 국기 인라인 SVG — Twemoji (MIT License, https://github.com/jdecked/twemoji) ═══
   Windows Segoe UI Emoji 가 건곤감리·문장·소욤보·앙코르와트·샤하다·5각별 디테일을 렌더하지 못하므로
   디자이너 제작 정식 SVG 를 직접 인라인. 키오스크 FLAG_SVGS 와 동일 자산. */
const _FLAG_STYLE=' style="width:1.2em;height:1.2em;vertical-align:-0.28em;display:inline-block"';
const _FLAG_KO='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#EEE" d="M36 27c0 2.209-1.791 4-4 4H4c-2.209 0-4-1.791-4-4V9c0-2.209 1.791-4 4-4h28c2.209 0 4 1.791 4 4v18z"/><path fill="#C60C30" d="M21.441 13.085c-2.714-1.9-6.455-1.24-8.356 1.474-.95 1.356-.621 3.227.737 4.179 1.357.949 3.228.618 4.178-.738s2.822-1.687 4.178-.736c1.358.95 1.688 2.821.737 4.178 1.901-2.714 1.241-6.455-1.474-8.357z"/><path fill="#003478" d="M22.178 17.264c-1.356-.951-3.228-.62-4.178.736s-2.821 1.687-4.178.737c-1.358-.951-1.687-2.822-.737-4.179-1.901 2.716-1.241 6.456 1.473 8.356 2.715 1.901 6.455 1.242 8.356-1.474.951-1.355.621-3.226-.736-4.176z"/><path d="M24.334 25.572l1.928-2.298.766.643-1.928 2.298zm2.57-3.063l1.928-2.297.766.643-1.928 2.297zm-1.038 4.351l1.928-2.297.766.643-1.928 2.297zm2.572-3.066l1.93-2.297.766.643-1.93 2.296zm-1.041 4.352l1.93-2.297.765.643-1.929 2.297zm2.571-3.065l1.927-2.3.767.643-1.927 2.3zm.004-14.162l.766-.643 1.93 2.299-.767.643zM27.4 7.853l.766-.643 1.928 2.299-.767.642zm-1.533 1.288l.766-.643 4.5 5.362-.766.643zm-1.532 1.284l.767-.643 1.927 2.298-.766.642zm2.57 3.065l.766-.643 1.93 2.297-.765.643zM6.4 20.854l.766-.643 4.499 5.363-.767.643zM4.87 22.14l.765-.642 1.929 2.298-.767.643zm2.567 3.066l.766-.643 1.93 2.297-.766.643zm-4.101-1.781l.766-.643 4.5 5.362-.767.643zm-.001-10.852l4.498-5.362.767.642-4.5 5.363zm1.532 1.287l4.5-5.363.766.643-4.5 5.362zM6.4 15.145l4.5-5.363.766.643-4.5 5.363z" fill="#292F33"/></svg>';
const _FLAG_ES='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#C60A1D" d="M36 27c0 2.209-1.791 4-4 4H4c-2.209 0-4-1.791-4-4V9c0-2.209 1.791-4 4-4h28c2.209 0 4 1.791 4 4v18z"/><path fill="#FFC400" d="M0 12h36v12H0z"/><path fill="#EA596E" d="M9 17v3c0 1.657 1.343 3 3 3s3-1.343 3-3v-3H9z"/><path fill="#F4A2B2" d="M12 16h3v3h-3z"/><path fill="#DD2E44" d="M9 16h3v3H9z"/><ellipse fill="#EA596E" cx="12" cy="14.5" rx="3" ry="1.5"/><ellipse fill="#FFAC33" cx="12" cy="13.75" rx="3" ry=".75"/><path fill="#99AAB5" d="M7 16h1v7H7zm9 0h1v7h-1z"/><path fill="#66757F" d="M6 22h3v1H6zm9 0h3v1h-3zm-8-7h1v1H7zm9 0h1v1h-1z"/></svg>';
const _FLAG_MN='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#C4272F" d="M36 27c0 2.209-1.791 4-4 4H4c-2.209 0-4-1.791-4-4V9c0-2.209 1.791-4 4-4h28c2.209 0 4 1.791 4 4v18z"/><path fill="#005197" d="M12 5h12v26H12z"/><g fill="#F9CF01"><path d="M1.286 16.429h1.571V29H1.286zm2.395 2.357H8.32v.786H3.681zm5.462-2.357h1.571V29H9.143zm-5.462 9.427H8.32v.786H3.681zm.087-9.427h4.464L6 17.989zm-.087 11.198h4.638L6 29.249zm3.89-15.913c0 .869-.704 1.571-1.571 1.571s-1.571-.703-1.571-1.571c0-.869.704-1.571 1.571-1.571s1.571.703 1.571 1.571zm-.785-2.946c0 .759-.352.982-.786.982s-.786-.223-.786-.982C5.214 8.008 5.754 7 6 7s.786 1.008.786 1.768z"/><path d="M6 14.404c-1.303 0-2.438-.593-3.084-1.477.271 1.462 1.546 2.567 3.084 2.567s2.813-1.105 3.084-2.566c-.646.883-1.781 1.476-3.084 1.476zm2.569 8.31c0-1.095-.687-2.022-1.649-2.39.299.257.58.447.58 1.062 0 .973-.578 1.496-1.5 1.496v.009c-.642.024-1.158.547-1.158 1.193 0 .645.516 1.167 1.158 1.191v.008c.01 0 .018-.003.028-.003.005 0 .009.003.014.003.015 0 .027-.008.042-.008 1.379-.045 2.485-1.169 2.485-2.561zm-2.94 1.37c0-.229.183-.413.413-.413.229 0 .413.184.413.413 0 .228-.183.414-.413.414-.23 0-.413-.186-.413-.414z"/><path d="M6 20.152v-.006l-.021.002-.01-.002c-.011 0-.02.006-.031.006-1.389.034-2.507 1.162-2.507 2.562 0 1.096.687 2.023 1.649 2.391-.299-.257-.557-.448-.557-.999 0-.98.524-1.522 1.43-1.522l.002-.018c.005 0 .009.003.014.003.668 0 1.211-.546 1.211-1.212 0-.659-.527-1.188-1.18-1.205zm-.031 1.62c-.231 0-.417-.188-.417-.417 0-.229.185-.419.417-.419s.417.189.417.419c-.001.229-.186.417-.417.417z"/></g></svg>';
const _FLAG_KM='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#032EA1" d="M36 27c0 2.209-1.791 4-4 4H4c-2.209 0-4-1.791-4-4V9c0-2.209 1.791-4 4-4h28c2.209 0 4 1.791 4 4v18z"/><path fill="#E01E24" d="M0 10.572h36v14.855H0z"/><path fill="#FFF" d="M27.021 22.897v-.902h-.542v-.901h-.496v-.586h-.226v-.451h-.438l-.238-.341v-1.599l.271-.271v-1.488l-.226.203v-.474h-.181v.226h-.359v-.723l-.429.384.136-.485-.249-1.116h-.136s-.111-.474-.337-.474c0 0 .09-.292-.091-.292s-.136.225-.136.225-.315.136-.315.473l-.18-.022-.271 1.307.191.384-.44-.384v.993H19.94v-.902l-.136.135v.316h-.315v-.316l.226-.203v-.428l-.182.191-.271-.372v-.316l-.157.157-.046-.27.226-.36-.034-.293-.258.315v-.27l.113-.248-.519-1.309-.124-.362-.191-.022v-.181s-.136-.315-.316-.315-.315.315-.315.315v.181l-.191.022-.125.362-.518 1.309.113.248v.27l-.259-.315-.035.293.226.36-.044.27-.158-.157v.316l-.27.372-.181-.191v.428l.226.203v.316h-.315v-.316l-.136-.135v.902H13.58v-.993l-.44.384.191-.384-.271-1.307-.181.022c0-.337-.315-.473-.315-.473s.045-.225-.136-.225c-.18 0-.09.292-.09.292-.226 0-.338.474-.338.474h-.135l-.248 1.116.135.485-.428-.384v.722h-.361v-.226h-.181v.474l-.225-.203v1.488l.27.271v1.599l-.239.341h-.348v.451h-.314v.586h-.452v.901h-.495v.902h-.497l-.045.991h19.035l.045-.991h-.496z"/><path fill="#DB7F86" d="M11.596 17.869v1.735h-.813l-.194.378h1.007v3.907h.342v-6.02zm13.731 2.113l-.178-.378h-.736v-1.735h-.338v6.02h.338v-3.907zm-8.222-2.113v1.735h-3.692v-1.745h-.33v6.02h.33v-3.897h3.692v3.907h.353v-6.02zm5.406 0v1.735h-3.599v-1.735h-.349v6.02h.349v-3.907h3.599v3.907h.427v-6.02z"/></svg>';
const _FLAG_SA='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#006C35" d="M32 5H4C1.791 5 0 6.791 0 9v18c0 2.209 1.791 4 4 4h28c2.209 0 4-1.791 4-4V9c0-2.209-1.791-4-4-4z"/><g fill="#FFF"><path d="M8.919 14.05c.632.06.283-1.069.512-1.274.043-.101.123-.102.129.026v.958c-.006.312.199.403.358.468.166-.013.276-.007.341.154l.078 1.658s.384.11.402-.933c.019-.612-.122-1.124-.039-1.243.003-.117.152-.124.256-.067.165.116.239.26.495.203.391-.107.625-.297.631-.597-.023-.285-.055-.57-.178-.855.017-.052-.075-.186-.058-.238.07.11.177.101.201 0-.066-.219-.169-.429-.337-.52-.138-.122-.34-.097-.414.157-.034.292.106.64.318.923.045.111.109.295.081.461-.113.064-.227.038-.321-.062 0 0-.311-.233-.311-.285.083-.528.019-.588-.027-.734-.032-.202-.128-.267-.206-.405-.078-.082-.183-.082-.233 0-.138.238-.074.75.026.979.071.21.181.343.129.343-.043.119-.131.091-.195-.046-.092-.284-.11-.707-.11-.898-.028-.236-.058-.741-.213-.869-.095-.129-.236-.067-.285.052-.01.234-.012.469.015.686.106.379.14.713.192 1.102.014.521-.301.226-.287-.032.073-.335.054-.863-.011-.997-.051-.133-.112-.167-.236-.145-.098-.008-.352.27-.424.73 0 0-.061.237-.087.448-.035.238-.191.406-.301-.033-.095-.319-.153-1.106-.312-.922-.046.615-.101 1.697.421 1.807z"/><path d="M9.87 14.499c-.52.01-1.281.683-1.302 1.056.548-.264 1.087-.518 1.645-.79-.09-.135-.005-.256-.343-.266z"/><path d="M12.737 16.516c.241-.803-.039-1.395.092-1.392.277.299.665.04.75-.064.037-.052.128-.086.192-.018.217.156.599.082.678-.192.046-.268.083-.546.092-.833-.177.055-.309.092-.321.165l-.037.238c-.015.077-.168.08-.174-.018-.067-.305-.345-.345-.513.128-.113.092-.317.11-.339-.027.027-.317-.101-.36-.357-.211-.082-.629-.165-1.23-.247-1.859.107-.003.205.076.302-.046-.107-.333-.333-1.013-.458-1.062-.061-.074-.113-.028-.192-.009-.134.043-.259.159-.22.384.159.965.263 1.7.421 2.665.024.113-.07.262-.192.247-.207-.14-.259-.424-.613-.412-.257.003-.55.281-.586.55-.043.213-.058.445 0 .632.18.216.397.195.586.146.155-.064.284-.22.338-.183.037.045.009.558-.732.952-.449.201-.806.247-.998-.119-.119-.229.009-1.099-.284-.897-.867 2.235 2.03 2.545 2.354.092.031-.101.153-.202.174-.037-.067 2.222-2.241 2.375-2.61 1.676-.092-.165-.119-.531-.128-.751-.055-.437-.284-.269-.32.164-.037.241-.027.309-.027.54.115 1.755 2.915 1.001 3.369-.449zm-1.08-1.518c-.018.034-.097.02-.155.02-.066-.003-.097-.014-.137-.067-.018-.06.038-.117.063-.162.031-.053.198-.108.257.04.026.067.003.136-.028.169z"/><path d="M13.602 13.009c.174-.064.999-1.007.999-1.007-.043-.037-.081-.064-.124-.101-.046-.04-.041-.08 0-.119.204-.119.139-.38.032-.499-.177-.08-.331-.054-.444.004-.143.137-.177.357-.064.495.11.052.22.163.147.224-.337.36-1.261.981-1.154 1.003.023.03.59.029.608 0zm.611-1.481c.053-.013.121.034.153.104.032.07.015.137-.037.15h-.002c-.052.013-.12-.034-.152-.104-.031-.071-.014-.137.038-.15zm-5.351 5.73c-.136.277-.193.087-.205-.068-.021-.294.007-.565.039-.779.034-.22 0-.153-.07-.064-.309.492-.336 1.228-.165 1.447.09.104.239.15.35.116.194-.084.279-.478.233-.621-.066-.101-.117-.117-.182-.031zm10.181-5.208c.356.478.694.965 1.025 1.461.065.43.112.85.14 1.267.055.804.071 1.674.021 2.521.15.006.393-.244.477-.609.055-.505-.02-1.404-.025-1.702-.005-.159-.015-.354-.027-.56.394.644.778 1.318 1.153 2.067.137-.064.107-.83.027-.938-.3-.643-.713-1.279-.845-1.523-.049-.09-.216-.346-.415-.639-.031-.336-.062-.608-.084-.698-.062-.428.177.047.144-.202-.077-.428-.315-.717-.593-1.109-.09-.127-.087-.153-.226.031-.058.131-.069.244-.066.351-.036-.053-.076-.108-.139-.185-.241-.207-.255-.219-.455-.388-.101-.072-.347-.202-.391.014-.022.191-.01.294.022.454.026.107.181.285.257.387zm.74-.024c.019.083.039.166.052.251l.015.081c-.059-.08-.108-.146-.131-.172-.164-.194-.028-.152.064-.16z"/><path d="M21.919 16.693c-.348.363-.85.81-1.396 1.017-.059.066.146.349.41.349.443-.052.833-.301 1.194-.956.097-.152.267-.479.271-.733.033-1.486-.074-2.643-.297-3.717-.015-.104-.006-.227.012-.259.028-.034.126 0 .178-.084.075-.078-.201-.718-.359-.964-.056-.11-.075-.184-.168.013-.098.16-.163.439-.155.699.211 1.463.276 2.744.414 4.207.011.141-.01.347-.104.428zm5.83-3.71c-.015-.104-.061-.346-.043-.377.028-.074.173.008.225-.077.076-.077-.374-.655-.531-.901-.057-.11-.076-.184-.169.013-.098.16-.132.447-.093.699.235 1.589.41 2.783.446 4.192-.021.134-.025.206-.088.374-.139.178-.292.4-.437.508-.144.107-.451.21-.552.289-.317.185-.318.396-.06.403.442-.052.966-.088 1.327-.634.097-.152.212-.565.217-.819.033-1.486-.019-2.596-.242-3.67zm-3.351 1.237c.004-.204.023-.474.034-.643.005-.063.02-.134.08-.15.061-.016.169.062.17-.004-.012-.129-.038-.321-.111-.412-.1-.148-.365-.112-.412.12.001.086.04.132.033.21-.012.044-.058.074-.167.022.018-.016-.071-.139-.071-.139-.085-.052-.199.003-.272.05-.041.074-.07.201-.024.33.12.227.539.612.74.616z"/><path d="M24.257 12.481c.293.359.592.723.893 1.093.065.826.082 1.502.146 2.328-.009.35-.117.655-.22.699 0 0-.155.09-.259-.009-.076-.031-.379-.505-.379-.505-.155-.142-.257-.102-.367 0-.304.293-.441.843-.647 1.221-.054.085-.204.157-.371-.006-.423-.579-.175-1.402-.227-1.19-.377.425-.211 1.128-.126 1.28.124.248.225.408.467.531.22.162.392.06.486-.053.222-.231.225-.816.329-.934.072-.213.257-.177.346-.082.087.124.189.204.315.273.207.183.454.216.697.049.166-.093.275-.214.372-.453.108-.288.049-1.612.027-2.406.155.2.306.409.459.618.067.663.105 1.323.083 1.997-.016.135.47-.4.466-.654-.002-.205 0-.391 0-.566.234.352.462.715.676 1.099.134-.07.09-.825.005-.929-.247-.414-.576-.845-.803-1.153-.015-.039-.023-.083-.041-.12-.091-.211-.034-.381-.077-.605-.042-.225-.031-.561-.096-.828-.018-.104-.072-.438-.056-.469.026-.075.126.002.175-.084.073-.08-.253-.925-.419-1.167-.06-.108-.168-.071-.302.105-.123.116-.077.38-.03.631.117.608.215 1.191.299 1.768-.161-.215-.356-.469-.545-.713l-.008-.044c0-.011-.027-.524-.051-.646-.004-.049-.016-.064.036-.058.055.046.062.049.097.065.056.01.105-.085.072-.172l-.517-.952c-.041-.041-.095-.085-.16.011-.063.055-.13.155-.128.283.016.225.055.455.07.681l.022.122c-.023-.027-.051-.061-.063-.073-.439-.462.202-.075-.084-.432-.242-.266-.312-.349-.52-.509-.104-.067-.167-.195-.201.023-.013.191-.027.414-.015.575 0 .092.093.26.174.36zm-8.901 1.079c.252.104.413-.376.517-.902.07-.148.124-.164.16-.088-.009.7.05.855.23 1.068.401.31.733.039.76.013l.312-.312c.069-.073.162-.078.26-.013.096.086.083.236.287.34.172.069.54.016.625-.132.115-.196.143-.264.195-.338.082-.109.222-.06.222-.026-.013.061-.095.122-.039.231.098.073.12.026.178.01.204-.098.356-.54.356-.54.009-.165-.083-.151-.143-.117-.078.047-.083.063-.161.111-.1.015-.293.081-.388-.067-.098-.178-.1-.426-.174-.605 0-.013-.13-.283-.009-.3.061.011.19.045.211-.063.063-.106-.137-.408-.273-.561-.119-.13-.284-.146-.443-.013-.112.103-.096.217-.118.326-.028.124-.022.278.105.443.111.219.314.502.247.898 0 0-.118.188-.325.164-.086-.019-.226-.056-.3-.606-.056-.417.014-1-.163-1.273-.064-.165-.11-.324-.266-.042-.042.111-.222.279-.091.626.107.219.15.576.102.974-.074.113-.09.151-.187.264-.136.146-.283.109-.396.054-.106-.071-.188-.108-.236-.334.009-.36.029-.95-.037-1.075-.097-.194-.257-.124-.326-.065-.329.301-.491.808-.59 1.211-.091.294-.188.21-.256.091-.166-.156-.177-1.373-.378-1.172-.323.914.182 1.918.532 1.82z"/><path d="M20.137 15.524l-.096-.055-1.881-.009c-.097-.037-.068-.069 0-.095.449-.061 1.248-.191 1.301-.958-.009-.399-.172-.661-.662-.733-.359.028-.616.377-.575.76-.017.104.034.306-.071.329-.691.063-1.444.495-1.469.805-.042.029-.136-.055-.124-.187-.026-.535-.202-1.14-.475-1.606-.218-.218-.15-.146-.296-.043-.094.108-.111.182-.106.397 0 .008.176.499.325.843.099.353.192.756.125 1.137-.232.504-.699.956-1.149 1.201-.232.075-.431.048-.48-.004-.143-.096-.136-.273-.125-.276.379-.265.813-.478 1.153-1.191.1-.272.13-.437.031-.858-.039-.158-.089-.286-.197-.398.061-.04.236.093.263.014-.04-.202-.177-.472-.331-.61-.135-.123-.282-.137-.406-.024-.14.078-.17.356-.103.6.074.184.275.215.419.584 0 .008.052.276-.022.381-.059.184-.824.785-.866.812-.021.026-.012-.013-.015-.113-.005-.122.049-.41.034-.412-.249.161-.332.654-.377.8-.63.435-1.343.759-1.755 1.201-.215.335 1.478-.385 1.675-.472.044.032.039.183.157.318.176.238.548.385.913.294.61-.221.963-.637 1.321-1.098.051-.075.131-.132.205-.075.246.551.957.941 1.874.982.213-.259.11-.384.024-.438 0-.008-.453-.18-.522-.352-.042-.156.06-.293.264-.397.589-.071 1.168-.15 1.729-.33.006-.188.115-.47.19-.592.072-.124.111-.087.1-.132zm-1.547-1.172c.028-.047.121-.045.208.006.087.05.136.13.107.177-.028.048-.122.045-.209-.006-.087-.05-.134-.129-.106-.177zm-.757 1.9c-.202.069-.396.123-.396.415.075.406-.103.267-.208.211-.124-.089-.473-.304-.523-.768-.008-.111.079-.204.218-.204.209.057.518.061.786.089.219.014.328.186.123.257zm-6.967-4.505c.216.104.624.06.606-.29 0-.031-.008-.135-.011-.163-.044-.103-.164-.078-.192.029-.009.035.015.091-.016.109-.018.018-.087.007-.084-.089 0-.031-.023-.064-.036-.083-.014-.009-.022-.012-.047-.012-.03.001-.03.009-.046.035-.007.025-.017.051-.017.08-.004.034-.017.046-.042.052-.028 0-.022.003-.044-.012-.014-.015-.031-.021-.031-.046 0-.026-.006-.068-.014-.086-.012-.016-.031-.023-.053-.029-.118 0-.126.135-.119.187-.011.009-.015.251.146.318z"/><path d="M17.512 14.027c0-.031-.023-.063-.036-.083-.014-.009-.022-.012-.047-.012-.03.001-.029.009-.046.035-.007.026-.017.051-.017.08-.003.035-.017.047-.042.052-.028 0-.022.003-.045-.011-.014-.015-.031-.021-.031-.046 0-.026-.006-.069-.014-.086-.012-.016-.031-.023-.053-.028-.118 0-.126.135-.12.186-.009.01-.014.251.147.319.217.103.732.043.606-.29 0-.031-.008-.135-.011-.164-.044-.103-.165-.077-.192.029-.008.035.016.091-.016.109-.016.018-.086.007-.083-.09zm3.397-.707c.216.104.623.06.605-.289 0-.031-.008-.135-.011-.164-.044-.103-.164-.077-.191.029-.009.035.015.091-.017.109-.018.018-.087.008-.084-.089 0-.031-.023-.064-.036-.083-.014-.009-.022-.012-.048-.012-.03.002-.029.009-.046.035-.007.026-.017.051-.017.08-.004.035-.017.047-.042.052-.028 0-.022.003-.045-.011-.014-.015-.03-.021-.03-.046 0-.026-.006-.069-.014-.087-.013-.016-.031-.023-.054-.028-.118 0-.126.135-.119.186-.007.01-.012.251.149.318zm.146-1.352c.077.216-.059.422.022.452.073.034.177-.223.215-.46.045-.192-.092-.585-.286-.666-.118-.028-.286.042-.232.2-.027.076.238.334.281.474zm1.995 5.064c.151.001.325-.345.399-.688.041-.472-.028-.759-.04-1.037-.013-.277-.313-2.392-.375-2.602-.073-.397.293-.053.253-.284-.127-.291-.442-.714-.542-.967-.06-.108-.034-.204-.168-.028-.123.405-.166.735-.119.987.318 1.66.644 3.04.592 4.619zm3.756-4.34c.035.108-.053.457.02.489.067.036.161-.241.196-.498.019-.141-.084-.633-.261-.721-.108-.03-.261.045-.211.217-.025.083.217.361.256.513zm-13.119 3.656c.065.027.154-.177.188-.366.019-.104-.081-.465-.25-.53-.104-.022-.246.006-.202.16-.005.083.23.183.244.376.034.08-.05.337.02.36zm-4.556-4.615c.033.083-.033.348.036.373.063.028.152-.184.185-.379.019-.108.004-.474-.246-.549-.103-.023-.246.034-.199.165-.024.062.187.274.224.39zm4.902 1.173c-.191.104-.266.412-.146.591.111.159.287.1.311.1.188.023.299-.352.299-.352s.006-.105-.217.094c-.094.018-.106-.017-.129-.071-.02-.097-.016-.195.029-.292.032-.093-.04-.134-.147-.07zm1.442-1.153c.071-.052.095-.086.118-.174.029-.146-.155.069-.178-.094-.041-.151.077-.213.189-.359.004-.101.002-.172-.135-.09-.096.065-.288.263-.294.491-.006.129-.03.128.055.21.061.089.122.08.245.016zm1.299.078c.124-.336.124-.478.133-.621-.038-.217-.185-.21-.282.031-.042.091-.091.57-.083.57-.033.143.149.204.232.02zm8.17 2.383s-1.003.713-1.027.738c-.1.088-.05.4 0 .364.071.028 1.08-.657 1.06-.737.047.002.07-.401-.033-.365zm-.123 1.934c.067.036.244-.183.237-.456.02-.141-.051-.658-.227-.746-.108-.03-.252.062-.202.233-.025.082.124.369.163.521.035.109-.044.416.029.448zm-5.68 1.496c0 .009.085.082.185.024.21-.081.342-.159.636-.224.077-.001.072-.208-.05-.215-.159.008-.307.016-.466.142-.098.022-.114-.037-.136-.091-.024-.133.055-.225.038-.324.006.006-.091-.083-.19-.033-.005 0-.221.146-.29.248-.043.033-.038.061-.025.116.033.076.092.053.158.017.088-.012.13.046.123.151-.042.133.017.182.017.189zm6.551.166c-.033.057-.055.143.047.17.188.053.621-.229.621-.234.07-.053.047-.152.041-.152-.041-.047-.133-.02-.195-.027-.029 0-.127-.015-.08-.101.038-.053.052-.086.078-.151.029-.065.004-.108-.102-.143-.107-.02-.15-.01-.269 0-.064.014-.086.042-.098.12.005.118.076.112.15.159.043.055.071.105-.003.194-.07.065-.119.101-.19.165zM25.5 23H24v-.5c0-.276-.224-.5-.5-.5s-.5.224-.5.5v.5H11s0 1 3 1h9v.5c0 .276.224.5.5.5s.5-.224.5-.5V24h1v.5c0 .276.224.5.5.5s.5-.224.5-.5v-1c0-.276-.224-.5-.5-.5z"/></g></svg>';
const _FLAG_CN='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"'+_FLAG_STYLE+'><path fill="#DE2910" d="M36 27c0 2.209-1.791 4-4 4H4c-2.209 0-4-1.791-4-4V9c0-2.209 1.791-4 4-4h28c2.209 0 4 1.791 4 4v18z"/><path fill="#FFDE02" d="M11.136 8.977l.736.356.589-.566-.111.81.72.386-.804.144-.144.804-.386-.72-.81.111.566-.589zm4.665 2.941l-.356.735.566.59-.809-.112-.386.721-.144-.805-.805-.144.721-.386-.112-.809.59.566zm-.957 3.779l.268.772.817.017-.651.493.237.783-.671-.467-.671.467.236-.783-.651-.493.817-.017zm-3.708 3.28l.736.356.589-.566-.111.81.72.386-.804.144-.144.804-.386-.72-.81.111.566-.589zM7 10.951l.929 2.671 2.826.058-2.253 1.708.819 2.706L7 16.479l-2.321 1.615.819-2.706-2.253-1.708 2.826-.058z"/></svg>';
let _svCachedUserDataPath='';
if(window.electronAPI&&window.electronAPI.getUserDataPath)window.electronAPI.getUserDataPath().then(function(p){_svCachedUserDataPath=p;}).catch(function(){});

/* ═══════════════════════════════════════
   인라인 헬퍼 — 백업 모듈 8개 통합
   ═══════════════════════════════════════ */

/* ── Workspace Store ── */
const _api=window.electronAPI||null;
function _wsReadJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch(e){return fallback;}}
function _wsLoadLocalWorkspace(){
  return {
    customSurveys:(Array.isArray(S.svCustomSurveys)?S.svCustomSurveys:null)||_wsReadJson('ec_sv_custom',[]),
    activeSurveys:_wsReadJson('ec_sv_active',[]),
    activities:_wsReadJson('ec_sv_activities',[]),
    history:_wsReadJson('ec_sv_history',[]),
    savePath:localStorage.getItem('ec_sv_savePath')||''
  };
}
function _wsPersistLocal(workspace){
  if(Array.isArray(workspace.customSurveys))S.svCustomSurveys=workspace.customSurveys;
  if(workspace.draft){
    try{localStorage.setItem('sv_surveyData',JSON.stringify(workspace.draft));
      if(_api&&_api.surveySaveDraft)_api.surveySaveDraft(workspace.draft).catch(function(){});
    }catch(e){}
  }
}
function _wsMerge(current,patch){return Object.assign({},current||{},patch||{});}
function _wsSave(workspace){
  _wsPersistLocal(workspace);
  if(_api&&_api.surveySaveWorkspace)return _api.surveySaveWorkspace(workspace).catch(function(e){console.error('[SurveyWorkspace] IPC 저장 실패:',e&&e.message?e.message:e);});
  return Promise.resolve(null);
}
function _wsFetch(){
  if(!(_api&&_api.surveyGetWorkspace))return Promise.resolve(null);
  return _api.surveyGetWorkspace().then(function(res){return res&&res.success&&res.data?res.data:null;}).catch(function(){return null;});
}

/* ── UI Helper ── */
function _uiApplyLangCardState(card,selected){
  if(!card)return;
  card.classList.toggle('selected',selected);
  card.style.borderColor=selected?'var(--cyan)':'var(--bdr)';
  card.style.background=selected?'rgba(6,182,212,0.08)':'var(--card)';
  const label=card.querySelector('span:last-child');
  if(label)label.style.color=selected?'var(--cyan)':'var(--t1)';
}
function _uiApplyGradeSelectionUi(button,allCheckbox,checkedCount,totalCount){
  if(button){button.disabled=checkedCount===0;button.style.opacity=checkedCount?'1':'0.5';}
  if(allCheckbox)allCheckbox.checked=checkedCount===totalCount;
}
function _uiToggleAccordionState(trigger){
  if(!trigger)return;
  const isOpen=trigger.classList.contains('open');
  trigger.classList.toggle('open',!isOpen);
  const body=trigger.nextElementSibling;
  if(body)body.classList.toggle('open',!isOpen);
}

/* ── Wizard Selection ── */
function _wizGetSelectableGrades(people){
  return Array.from(new Set((people||[]).filter(function(s){return s.type==='student';}).map(function(s){return s.grade;}))).sort(function(a,b){return a-b;});
}
function _wizCountStudentsByGrade(people,grade){
  return(people||[]).filter(function(s){return s.type==='student'&&s.grade===grade;}).length;
}
function _wizCollectSelectedGrades(nodeList){
  const out=[];(nodeList||[]).forEach(function(cb){out.push(parseInt(cb.value));});return out;
}
function _wizBuildClassGroups(people,selectedGrades){
  const stuList=(people||[]).filter(function(s){return s.type==='student'&&selectedGrades.indexOf(s.grade)!==-1;});
  const groups={};
  stuList.forEach(function(s){const k=s.grade+'-'+s.cls;if(!groups[k])groups[k]={grade:s.grade,cls:s.cls,people:[]};groups[k].people.push(s);});
  Object.keys(groups).forEach(function(k){groups[k].people.sort(function(a,b){return(a.num||0)-(b.num||0);});});
  return groups;
}
function _wizApplyClassSelection(selectedMap,chips,checked){
  (chips||[]).forEach(function(c){const sid=parseInt(c.dataset.sid);selectedMap[sid]=checked;});
}
function _wizToggleStudentSelection(selectedMap,sid){
  selectedMap[sid]=!selectedMap[sid];return selectedMap[sid];
}
function _wizAreAllClassStudentsSelected(selectedMap,chips){
  let allChecked=true;(chips||[]).forEach(function(c){if(!selectedMap[parseInt(c.dataset.sid)])allChecked=false;});return allChecked;
}

/* ── Wizard ViewModel ── */
function _vmGetGradeLabel(grade,schoolLevel){return schoolLevel==='kindergarten'?grade+'세':grade+'학년';}
function _vmBuildGradeCards(grades,people,schoolLevel){
  return(grades||[]).map(function(g){
    return{grade:g,label:_vmGetGradeLabel(g,schoolLevel),count:_wizCountStudentsByGrade(people,g)};
  });
}
function _vmBuildClassCardModels(groups,schoolLevel,selectedMap,careLabelFn,isCareFn){
  return Object.keys(groups||{}).sort().map(function(key){
    const g=groups[key];
    return{key:key,title:(schoolLevel==='kindergarten'?g.grade+'세':g.grade+'학년')+' '+g.cls+'반',count:g.people.length,
      people:(g.people||[]).map(function(s){
        const care=isCareFn?isCareFn(s):false;
        return{id:s.id,num:s.num,name:s.name,checked:!selectedMap.hasOwnProperty(s.id)||!!selectedMap[s.id],care:care,careLabel:care&&careLabelFn?careLabelFn(s):''};
      })};
  });
}

/* ── Draft Model ── */
function _dmGetQuestion(draft,si,qi){
  if(!draft||!draft.sections||!draft.sections[si]||!draft.sections[si].questions)return null;
  return draft.sections[si].questions[qi]||null;
}
function _dmChangeQuestionType(draft,si,qi,newType){
  const q=_dmGetQuestion(draft,si,qi);if(!q)return null;
  q.type=newType;
  if((newType==='radio'||newType==='checkbox'||newType==='dropdown')&&(!q.options||!q.options.length))q.options=['선택지 1','선택지 2'];
  if((newType==='grid_radio'||newType==='grid_text')&&!q.gridRows){q.gridRows=['행 1','행 2'];q.gridCols=['열 1','열 2','열 3'];}
  if(newType==='scale'&&(!q.options||!q.options.length))q.options=['1','2','3','4','5'];
  return q;
}
function _dmAddOption(draft,si,qi){
  const q=_dmGetQuestion(draft,si,qi);if(!q)return -1;
  if(!Array.isArray(q.options))q.options=[];
  const newIdx=q.options.length;q.options.push('');return newIdx;
}
function _dmToggleSectionJump(draft,si,qi){
  const q=_dmGetQuestion(draft,si,qi);if(!q)return null;
  q.sectionJump=!q.sectionJump;if(q.sectionJump&&!q.jumpMap)q.jumpMap={};return q;
}
function _dmShuffleOptions(draft,si,qi){
  const q=_dmGetQuestion(draft,si,qi);if(!q||!q.options||q.options.length<2)return false;
  for(let i=q.options.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const tmp=q.options[i];q.options[i]=q.options[j];q.options[j]=tmp;}
  return true;
}
function _dmSplitSection(draft,si,qi){
  if(!draft||!draft.sections||!draft.sections[si])return false;
  const remaining=draft.sections[si].questions.splice(qi+1);if(!remaining.length)return false;
  draft.sections.splice(si+1,0,{id:'s'+Date.now(),title:'새 섹션',desc:'',questions:remaining});return true;
}
function _dmAddQuestion(draft,si){
  if(!draft||!draft.sections||!draft.sections[si])return false;
  draft.sections[si].questions.push({id:draft.nextId++,text:'새 문항',desc:'',type:'radio',required:false,options:['선택지 1','선택지 2']});return true;
}
function _dmAddSection(draft){
  if(!draft||!draft.sections)return false;
  draft.sections.push({id:'s'+Date.now(),title:'새 섹션',questions:[{id:draft.nextId++,text:'새 문항',type:'radio',required:false,options:['선택지 1','선택지 2']}]});return true;
}
function _dmDeleteQuestion(draft,si,qi){
  if(!draft||!draft.sections||!draft.sections[si])return false;
  draft.sections[si].questions.splice(qi,1);if(!draft.sections[si].questions.length)draft.sections.splice(si,1);return true;
}
function _dmDuplicateQuestion(draft,si,qi){
  const q=_dmGetQuestion(draft,si,qi);if(!q)return false;
  const copy=JSON.parse(JSON.stringify(q));copy.id=draft.nextId++;copy.text=q.text+' (복사)';
  draft.sections[si].questions.splice(qi+1,0,copy);return true;
}

/* ── Draft Bootstrap ── */
function _dbLoadLocalDraft(){
  try{
    const saved=localStorage.getItem('sv_surveyData');if(!saved)return null;
    const parsed=JSON.parse(saved);let needReset=false;
    if(parsed.sections){
      if(parsed.sections[0]&&parsed.sections[0].questions&&parsed.sections[0].questions.some(function(q){return q.id===2&&q.text==='비동의 사유';}))needReset=true;
      if(!needReset&&parsed.sections.some(function(s){return s.id==='s4'&&s.title==='질병 이력 및 건강 상태';}))needReset=true;
      if(!needReset)parsed.sections.forEach(function(s){if(s.questions)s.questions.forEach(function(q){if(q.id===23&&q.type==='checkbox')needReset=true;});});
    }
    return needReset?null:parsed;
  }catch(e){return null;}
}
function _dbLoadBackendDraft(){
  if(!(_api&&_api.surveyGetWorkspace))return Promise.resolve(null);
  return _api.surveyGetWorkspace().then(function(res){return res&&res.success&&res.data&&res.data.draft?res.data.draft:null;}).catch(function(){return null;});
}
function _dbLoadDefaultDraft(schoolName,year){
  if(!(_api&&_api.surveyGetDefaultDraftSync))return Promise.resolve(null);
  return _api.surveyGetDefaultDraftSync(schoolName,year).then(function(res){return res&&res.success&&res.data?res.data:null;}).catch(function(){return null;});
}
function _dbPersistLocalDraft(draft){
  try{localStorage.setItem('sv_surveyData',JSON.stringify(draft));
    if(_api&&_api.surveySaveDraft)_api.surveySaveDraft(draft).catch(function(){});
  }catch(e){}
}

/* ── Draft Autosave ── */
let _asTimer=null;
function _asScheduleSave(draft,delay){
  clearTimeout(_asTimer);
  _asTimer=setTimeout(function(){
    if(!draft)return;
    localStorage.setItem('sv_surveyData',JSON.stringify(draft));
    if(_api&&_api.surveySaveDraft)_api.surveySaveDraft(draft).catch(function(){});
  },delay||300);
}

/* ── Translation Helper ── */
const _trLangNames={en:'영어(English)',ru:'러시아어(Русский)',vi:'베트남어(Tiếng Việt)',km:'캄보디아어(ភាសាខ្មែរ)',th:'태국어(ภาษาไทย)',tl:'필리핀어(Filipino)',zh:'중국어(中文)',ja:'일본어(日本語)'};
function _trGetQuestionPrompt(langCode){
  const ln=_trLangNames[langCode]||langCode;
  return '당신은 유능한 한국어-'+ln+' 동시 통역 및 번역 전문가입니다. 20년 이상의 경력을 갖추고 있으며 학교 보건 및 교육 분야의 전문 용어에 정통합니다.\n\n아래 설문 문항을 '+ln+'로 번역해 주세요.\n\n[중요 지침]\n• 번역은 반드시 '+ln+' 원어민이 자기 나라 말을 읽는 것처럼 완전히 자연스러워야 합니다. 직역이 아닌, 해당 언어권 사람이 일상적으로 사용하는 표현과 어순으로 작성해 주세요.\n• 출력 형식: 아래 한국어 원문의 형식을 그대로 유지하되, 내용만 '+ln+'로 바꿔서 출력해 주세요. [문항], 보기1, 보기2 등의 태그와 구조는 그대로 두고 한국어 텍스트 부분만 번역합니다.\n\n---\n';
}
function _trBuildQuestionText(q){
  const isChoice=q.type==='radio'||q.type==='checkbox'||q.type==='dropdown';
  const typeDesc={short_text:'(단답형 — 응답자가 짧은 텍스트를 직접 입력합니다)',paragraph:'(장문형 — 응답자가 긴 텍스트를 직접 입력합니다)',date_cal:'(날짜 선택)',date_text:'(날짜 입력)',time_clock:'(시간 선택)',time_text:'(시간 입력)',star:'(별점 평가)',scale:'(선형배율)',grid_radio:'(그리드 객관식)',grid_text:'(그리드 주관식)'};
  const lines=[];lines.push('[문항] '+q.text);
  if(isChoice&&q.options&&q.options.length>0){q.options.forEach(function(o,i){lines.push('  보기'+(i+1)+'. '+o);});if(q.hasOther)lines.push('  보기'+(q.options.length+1)+'. 기타 (직접 입력)');}
  else{lines.push('  → 응답 형식: '+(typeDesc[q.type]||q.type));}
  return lines.join('\n');
}
function _trGetDescriptionPrompt(langCode){
  const ln=_trLangNames[langCode]||langCode;
  return '당신은 유능한 한국어-'+ln+' 동시 통역 및 번역 전문가입니다. 20년 이상의 경력을 갖추고 있으며 학교 보건 및 교육 분야의 전문 용어에 정통합니다.\n\n아래 설문 섹션의 설명문을 '+ln+'로 번역해 주세요.\n\n[중요 지침]\n• 번역은 반드시 '+ln+' 원어민이 자기 나라 말을 읽는 것처럼 완전히 자연스러워야 합니다. 직역이 아닌, 해당 언어권 사람이 일상적으로 사용하는 표현과 어순으로 작성해 주세요.\n• 출력 형식: 아래 한국어 원문 전체를 먼저 읽은 뒤, 동일한 형식과 구조를 유지하면서 내용 전체를 '+ln+'로 바꿔서 출력해 주세요. 한국어와 외국어를 번갈아 섞지 말고, '+ln+' 번역문만 통으로 출력합니다.\n\n---\n';
}
function _trBuildPreviewText(promptText,koreanText){return String(promptText||'')+String(koreanText||'');}

/* ═══════════════════════════════════════ */

const SV_TEMPLATES=[
  {type:'health',icon:'📋',title:'학생 건강 상태 조사',desc:'학생의 건강 상태, 질병력, 알레르기 등을 조사합니다'},
  {type:'smoking',icon:'🚬',title:'흡연 실태 조사',desc:'학생의 흡연 경험 및 현황을 조사합니다'},
  {type:'gender',icon:'⚖️',title:'성인지·양성평등 인식 조사',desc:'성인지 감수성 및 양성평등 인식을 조사합니다'}
];
const SV_DUMMY_HISTORY=[
  {date:'2026-03-15',title:'학생 건강 상태 조사',target:'1,2학년 전체',rate:'82.5%',newsletter:true,status:'종료'},
  {date:'2025-03-10',title:'흡연 실태 조사',target:'전체 학년',rate:'91.2%',newsletter:true,status:'종료'}
];
/* svCustomSurveys / svWorkspaceCache:
 * helpers.js _initJsonLoad → DB → S.svCustomSurveys 로 비동기 로드됩니다.
 * 모듈 로드 시 _wsLoadLocalWorkspace()로 localStorage/S 상태에서 초기화합니다. */
const _wsInitial=_wsLoadLocalWorkspace();
S.svCustomSurveys=Array.isArray(S.svCustomSurveys)?S.svCustomSurveys:(_wsInitial.customSurveys||[]);
let svWorkspaceCache=_wsInitial;
export function getSvWorkspaceCache(){return svWorkspaceCache;}
function _svGetHistory(){return Array.isArray(svWorkspaceCache.history)?svWorkspaceCache.history:[];}
function _svGetActivities(){return Array.isArray(svWorkspaceCache.activities)?svWorkspaceCache.activities:[];}
function _svGetActiveSurveys(){return Array.isArray(svWorkspaceCache.activeSurveys)?svWorkspaceCache.activeSurveys:[];}
function _svPersistWorkspace(patch){
  svWorkspaceCache=_wsMerge(svWorkspaceCache,patch||{});
  if(Array.isArray(svWorkspaceCache.customSurveys))S.svCustomSurveys=svWorkspaceCache.customSurveys;
  _wsSave(svWorkspaceCache);
}
function _svSyncWorkspaceFromBackend(refreshFn){
  _wsFetch().then(function(d){
    if(!d)return;
    svWorkspaceCache=_wsMerge(svWorkspaceCache,d);
    if(Array.isArray(d.customSurveys))S.svCustomSurveys=d.customSurveys;
    _wsPersistLocal(svWorkspaceCache);
    if(typeof refreshFn==='function')refreshFn();
  }).catch(function(){});
}

/* ═══ 설문 서브탭 전환 ═══ */
/* 현재 열려있는 패널 추적 — 비동기 콜백에 의한 패널 덮어쓰기 방지 */
let _svCurrentPanel = 'home';

export function svSwitchSub(sub){
  /* 위저드/통계 등 다른 패널이 열려있으면 먼저 홈으로 리셋 */
  _svCurrentPanel = 'home';
  ['template','active','allstats'].forEach(function(k){
    const el=document.getElementById('svSub'+k.charAt(0).toUpperCase()+k.slice(1));
    if(el)el.style.display=k===sub?'block':'none';
  });
  const tabT=document.getElementById('svSubTabTemplate');if(tabT)tabT.classList.toggle('active',sub==='template');
  const tabA=document.getElementById('svSubTabActive');if(tabA)tabA.classList.toggle('active',sub==='active');
  const tabS=document.getElementById('svSubTabAllStats');if(tabS)tabS.classList.toggle('active',sub==='allstats');
  /* 다른 패널(wizard,stats 등) 숨기기 */
  document.querySelectorAll('.sv-panel').forEach(function(el){el.style.display='none';});
  if(sub==='template'){const h=document.getElementById('sv-home');if(h)h.style.display='block';svRenderHome();}
  if(sub==='active')svRenderActivePast();
  if(sub==='allstats')svRenderAllStats();
}

function _closeSvOverlay(ov){if(ov)closeModalGracefully(ov);}

function svOpenPanel(panel,params){
  _svCurrentPanel = panel;
  /* 설문 탭이 보이지 않으면 매직 스테이션에서 활성화 */
  const surveyWrap=document.getElementById('magicSubSurvey');
  if(surveyWrap&&!surveyWrap.classList.contains('active')){
    /* _magicSwitchSub 호출 전에 패널 플래그 보호 */
    const savedPanel = panel;
    const savedParams = params;
    _svCurrentPanel = '__switching__';
    _magicSwitchSub('survey',document.getElementById('magicSubTabSurvey'));
    if(S.currentView!=='magic')switchView('magic');
    _svCurrentPanel = savedPanel;
  }
  /* 서브탭 패널 숨기기 */
  ['svSubTemplate','svSubActive','svSubAllStats'].forEach(function(id){const e=document.getElementById(id);if(e)e.style.display='none';});
  document.querySelectorAll('.sv-panel').forEach(function(el){el.style.display='none';});
  const target=document.getElementById('sv-'+panel);
  if(target)target.style.display='block';
  /* home이면 svSubTemplate도 보이도록 */
  if(panel==='home'){const tmpl=document.getElementById('svSubTemplate');if(tmpl)tmpl.style.display='block';}
  try{
    if(panel==='home')svRenderHome();
    if(panel==='wizard')svRenderWizard(params);
    if(panel==='stats')svRenderStats(params);
    if(panel==='newsletter')svRenderNewsletter(params);
    if(panel==='history')svRenderHistory();
  }catch(e){console.error('[SURVEY] svOpenPanel 오류:',e);if(target)target.innerHTML='<div style="padding:20px;color:var(--rs)">오류: '+escHtml(String(e.message||'알 수 없는 오류'))+'</div>';}
  /* 부모 스크롤 영역을 맨 위로 이동 */
  const chartBody=document.querySelector('#view-magic .magic-chart-body');
  if(chartBody)chartBody.scrollTop=0;
  const surveyEl=document.getElementById('magicSubSurvey');
  if(surveyEl)surveyEl.scrollTop=0;
}

function svRenderHome(){
  /* 다른 패널(위저드/통계 등)이 열려있으면 홈 렌더링 건너뛰기 */
  if(_svCurrentPanel!=='home'&&_svCurrentPanel!=='__switching__')return;
  const el=document.getElementById('sv-home');if(!el)return;
  /* 비동기 워크스페이스 동기화: 최초 1회만 실행 (무한 루프 방지) */
  if(!svRenderHome._synced){
    svRenderHome._synced=true;
    _svSyncWorkspaceFromBackend(function(){
      /* 콜백에서 다시 svRenderHome 호출하되 재동기화는 하지 않음 (_synced=true 유지) */
      if(_svCurrentPanel==='home'){svRenderHome();}
    });
  }
  let h='<div class="sv-header"><div></div>'
    +'<button class="sv-btn-primary" data-sv-action="openPanel" data-sv-panel="wizard" data-sv-params="{}">+ 새 설문 만들기</button></div>';
  h+='<div class="sv-section-title">기본 설문 템플릿</div><div class="sv-card-grid">';
  SV_TEMPLATES.forEach(function(t){
    h+='<div class="sv-card"><div class="sv-card-icon">'+t.icon+'</div><div class="sv-card-title">'+t.title+'</div><div class="sv-card-desc">'+t.desc+'</div>'
      +'<div class="sv-card-actions">'
      +'<button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="wizard" data-sv-params=\'{"templateType":"'+t.type+'"}\'>설문 시작</button>'
      +'<button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="stats" data-sv-params=\'{"surveyType":"'+t.type+'"}\'>통계 보기</button>'
      +'<button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="history" data-sv-params=\'{"surveyType":"'+t.type+'"}\'>과거 기록</button></div></div>';
  });
  h+='</div>';
  h+='<div class="sv-section-title">내 설문 (커스텀)</div><div class="sv-card-grid">';
  for(let i=0;i<3;i++){
    if(S.svCustomSurveys[i]){
      const c=S.svCustomSurveys[i];
      h+='<div class="sv-card"><div class="sv-card-icon">📝</div><div class="sv-card-title">'+escHtml(c.title)+'</div><div class="sv-card-desc">'+(escHtml(c.desc)||'커스텀 설문')+'</div>'
        +'<div class="sv-card-actions">'
        +'<button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="wizard" data-sv-params=\'{"customIdx":'+i+'}\'>설문 시작</button>'
        +'<button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="stats" data-sv-params=\'{"customIdx":'+i+'}\'>통계 보기</button></div></div>';
    } else {
      h+='<div class="sv-card sv-card-empty" data-sv-action="openPanel" data-sv-panel="wizard" data-sv-params="{}">+ 새 설문 등록</div>';
    }
  }
  h+='</div>';
  h+=_svDataStorageHtml('template');
  el.innerHTML=h;
  _svInitSavePath('template');
  /* innerHTML 후 버튼에 직접 이벤트 바인딩 (CSP/Electron 호환) */
  el.querySelectorAll('[data-sv-action]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const panel = this.dataset.svPanel || 'home';
      let params = {};
      try { params = JSON.parse(this.dataset.svParams || '{}'); } catch(_){}
      svOpenPanel(panel, params);
    });
  });
}

/* ═══ 설문 데이터 저장 공통 ═══ */
function _svDataStorageHtml(tabId){
  /* fallback 경로 — Electron 실제 userData 는 package.json "name" (my-health-diary) 기반.
     Mac/Win 실제 경로에 맞춰 표기 (my-health-diary 소문자·하이픈, Windows 는 Roaming). */
  const _isWinSv = navigator.platform && navigator.platform.indexOf('Win')>=0;
  const appBase = _svCachedUserDataPath
    || (_isWinSv ? 'C:\\Users\\<사용자>\\AppData\\Roaming\\my-health-diary' : '~/Library/Application Support/my-health-diary');
  const yr=new Date().getFullYear();
  const tabNames={template:'설문_템플릿',active:'현재_과거_설문',allstats:'설문_통계'};
  const tabFolder=tabNames[tabId]||tabId;
  let h='<div class="sv-section-title">데이터 저장</div>';
  h+='<div class="cc" style="padding:12px;margin-bottom:8px">';
  h+='<div style="font-size:11px;color:var(--t3);margin-bottom:8px">설문 응답 데이터 저장 위치</div>';
  /* 연도별 폴더 구조 */
  const activities=_svGetActivities();
  const years={};years[yr]=true;
  activities.forEach(function(a){if(a.date){const y=parseInt(a.date.substring(0,4));if(y)years[y]=true;}});
  const yearList=Object.keys(years).sort().reverse();
  h+='<div style="display:flex;flex-direction:column;gap:3px">';
  yearList.forEach(function(y){
    const path=appBase+'/'+tabFolder+'/'+y;
    h+='<div style="font-size:10px;font-family:var(--fm);color:var(--t2);padding:3px 8px;background:var(--bg2);border-radius:4px">📁 '+path+'</div>';
  });
  h+='</div>';
  h+='</div>';
  return h;
}
function _svInitSavePath(tabId){
  const basePath=(typeof svWorkspaceCache.savePath==='string'&&svWorkspaceCache.savePath)?svWorkspaceCache.savePath:(localStorage.getItem('ec_sv_savePath')||'');
  if(!basePath&&window.electronAPI&&window.electronAPI.getDefaultSavePath){
    window.electronAPI.getDefaultSavePath().then(function(p){
      if(p){_svPersistWorkspace({savePath:p});if(window.electronAPI.surveySavePath)window.electronAPI.surveySavePath(p);const el=document.getElementById('svSavePathDisplay_'+tabId);if(el)el.textContent=p;}
    }).catch(function(err){console.error('[ERROR] getDefaultSavePath',err);});
  }
}
/* ═══ 현재/과거 설문 탭 ═══ */
function svRenderActivePast(){
  const el=document.getElementById('sv-active-panel');if(!el)return;
  if(!svRenderActivePast._synced){svRenderActivePast._synced=true;_svSyncWorkspaceFromBackend(function(){svRenderActivePast._synced=false;svRenderActivePast();});}
  let h='<div style="padding:14px">';
  /* 제목 제거 — 탭 자체가 제목 */
  /* 현재 진행 중인 설문 */
  const activeSurveys=_svGetActiveSurveys();
  h+='<div class="sv-section-title">현재 진행 중인 설문</div>';
  if(!activeSurveys.length){
    h+='<div class="cc" style="padding:16px;margin-bottom:16px;text-align:center;color:var(--t3);font-size:12px">현재 진행 중인 설문이 없습니다.</div>';
  } else {
    h+='<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">';
    activeSurveys.forEach(function(sv,idx){
      const daysLeft=sv.endDate?Math.max(0,Math.ceil((new Date(sv.endDate)-new Date())/(1000*60*60*24))):0;
      const statusColor=daysLeft>3?'var(--gs)':daysLeft>0?'var(--yl)':'var(--rs)';
      const statusText=daysLeft>0?'D-'+daysLeft:'마감';
      h+='<div class="cc" style="padding:12px;display:flex;align-items:center;gap:12px">'
        +'<div style="position:relative;width:44px;height:44px;flex-shrink:0"><svg viewBox="0 0 36 36" style="width:44px;height:44px;transform:rotate(-90deg)"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg2)" stroke-width="3"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="'+statusColor+'" stroke-width="3" stroke-dasharray="'+(sv.rate||0)+' '+(100-(sv.rate||0))+'" stroke-linecap="round"/></svg>'
        +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:'+statusColor+'">'+(sv.rate||0)+'%</div></div>'
        +'<div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(sv.title)+'</div>'
        +'<div style="font-size:10px;color:var(--t3)">'+(sv.startDate||'')+' ~ '+(sv.endDate||'')+' · '+escHtml(sv.target||'전체')+'</div></div>'
        +'<span style="font-size:11px;font-weight:700;color:'+statusColor+';flex-shrink:0;padding:3px 8px;border-radius:6px;border:1px solid '+statusColor+';background:rgba(0,0,0,0.03)">'+statusText+'</span>'
        +'<button class="sv-btn sv-btn-sm" data-sv-click="openPanel" data-sv-panel="stats\">통계</button>'
        +'</div>';
    });
    h+='</div>';
  }
  /* 과거에 진행한 설문 */
  h+='<div class="sv-section-title">과거에 진행한 설문</div>';
  const activities=_svGetActivities();
  if(!activities.length){
    h+='<div class="cc" style="padding:16px;text-align:center;color:var(--t3);font-size:12px;margin-bottom:12px">아직 생성된 설문이 없습니다.</div>';
  } else {
    h+='<div class="cc" style="padding:10px;overflow-x:auto;margin-bottom:12px"><table class="rec-table"><thead><tr><th>날짜</th><th>설문명</th><th>대상</th><th>응답률</th><th>상태</th></tr></thead><tbody>';
    activities.forEach(function(a){h+='<tr><td>'+escHtml(a.date)+'</td><td>'+escHtml(a.title)+'</td><td>'+escHtml(a.target)+'</td><td>'+escHtml(a.rate)+'</td><td>'+escHtml(a.status)+'</td></tr>';});
    h+='</tbody></table></div>';
  }
  h+=_svDataStorageHtml('active');
  h+='</div>';
  el.innerHTML=h;
  _svInitSavePath('active');
}

/* ═══ 설문 통계 탭 (모든 설문 통합) ═══ */
function svRenderAllStats(){
  const el=document.getElementById('sv-allstats-panel');if(!el)return;
  if(!svRenderAllStats._synced){svRenderAllStats._synced=true;_svSyncWorkspaceFromBackend(function(){svRenderAllStats._synced=false;svRenderAllStats();});}
  let h='<div style="padding:14px">';
  /* 제목 제거 — 탭 자체가 제목 */
  /* 모든 활동 + 현재 진행 중 합치기 */
  const activities=_svGetActivities();
  const activeSurveys=_svGetActiveSurveys();
  const allSurveys=[];
  activeSurveys.forEach(function(sv){allSurveys.push({date:sv.startDate||'',title:sv.title,target:sv.target||'전체',rate:(sv.rate||0)+'%',status:'진행중',type:'active'});});
  activities.forEach(function(a){allSurveys.push({date:a.date,title:a.title,target:a.target,rate:a.rate,status:a.status||'종료',type:'past'});});
  /* 기본 템플릿 통계도 표시 */
  SV_TEMPLATES.forEach(function(t){
    h+='<div class="sv-section-title">'+t.icon+' '+t.title+'</div>';
    const matched=allSurveys.filter(function(s){return s.title&&s.title.indexOf(t.title)!==-1;});
    if(matched.length===0){
      h+='<div class="cc" style="padding:12px;margin-bottom:12px;text-align:center;color:var(--t3);font-size:11px">해당 설문을 실시한 기록이 없습니다. <button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="wizard" data-sv-params=\'{"templateType":"'+t.type+'"}\'>설문 시작</button></div>';
    } else {
      h+='<div class="cc" style="padding:10px;overflow-x:auto;margin-bottom:12px"><table class="rec-table"><thead><tr><th>날짜</th><th>대상</th><th>응답률</th><th>상태</th><th></th></tr></thead><tbody>';
      matched.forEach(function(m){
        h+='<tr><td>'+escHtml(m.date)+'</td><td>'+escHtml(m.target)+'</td><td>'+escHtml(m.rate)+'</td><td>'+escHtml(m.status)+'</td>'
          +'<td><button class="sv-btn sv-btn-sm" data-sv-action="openPanel" data-sv-panel="stats" data-sv-params=\'{"surveyType":"'+t.type+'"}\'>상세 통계</button></td></tr>';
      });
      h+='</tbody></table></div>';
    }
  });
  /* 커스텀 설문 통계 */
  if(S.svCustomSurveys.length>0){
    S.svCustomSurveys.forEach(function(c,ci){
      if(!c)return;
      h+='<div class="sv-section-title">📝 '+escHtml(c.title)+'</div>';
      const matched=allSurveys.filter(function(s){return s.title&&s.title===c.title;});
      if(matched.length===0){
        h+='<div class="cc" style="padding:12px;margin-bottom:12px;text-align:center;color:var(--t3);font-size:11px">해당 설문을 실시한 기록이 없습니다.</div>';
      } else {
        h+='<div class="cc" style="padding:10px;overflow-x:auto;margin-bottom:12px"><table class="rec-table"><thead><tr><th>날짜</th><th>대상</th><th>응답률</th><th>상태</th><th></th></tr></thead><tbody>';
        matched.forEach(function(m){
          h+='<tr><td>'+escHtml(m.date)+'</td><td>'+escHtml(m.target)+'</td><td>'+escHtml(m.rate)+'</td><td>'+escHtml(m.status)+'</td>'
            +'<td><button class="sv-btn sv-btn-sm" data-sv-click="openPanel" data-sv-panel="stats" data-sv-custom-idx="'+ci+'">상세 통계</button></td></tr>';
        });
        h+='</tbody></table></div>';
      }
    });
  }
  h+=_svDataStorageHtml('allstats');
  h+='</div>';
  el.innerHTML=h;
  _svInitSavePath('allstats');
  /* data-sv-action 버튼에 이벤트 바인딩 */
  el.querySelectorAll('[data-sv-action]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      const panel = this.dataset.svPanel || 'home';
      let params = {};
      try { params = JSON.parse(this.dataset.svParams || '{}'); } catch(_){}
      svOpenPanel(panel, params);
    });
  });
}

function svRenderWizard(params){
  const el=document.getElementById('sv-wizard');if(!el)return;
  svWizardSelectedGrades=[];svWizardSelectedStudents={};
  let h='<button class="sv-back-btn" data-sv-click="openPanel" data-sv-panel="home\">← 설문 홈으로</button>';
  h+='<div id="sv-wizard-steps" style="margin-top:12px"></div>';
  h+='<div id="sv-wizard-step-1"></div><div id="sv-wizard-step-2" style="display:none;max-height:calc(100vh - 260px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.4) transparent" class="sv-class-list"></div><div id="sv-wizard-step-3" style="display:none"></div><div id="sv-wizard-step-4" style="display:none;max-height:calc(100vh - 370px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(6,182,212,0.4) transparent" class="sv-class-list"></div><div id="sv-wizard-step-5" style="display:none"></div>';
  el.innerHTML=h;
  svWizardStep(1);
}

function svRenderStepIndicator(current){
  const names=['대상 선택','반/학생 선택','언어 선택','설문 편집','완료'];
  let h='<div class="sv-steps">';
  for(let i=0;i<5;i++){
    const cls=i<current-1?'done':i===current-1?'active':'';
    const num=i<current-1?'✓':(i+1);
    h+='<div class="sv-step '+cls+'"><span class="sv-step-num">'+num+'</span>'+names[i]+'</div>';
    if(i<4)h+='<div class="sv-step-line'+(i<current-1?' done':'')+'"></div>';
  }
  h+='</div>';
  document.getElementById('sv-wizard-steps').innerHTML=h;
}

const svWizardSelectedLangs=['ko'];
function svWizardStep(n){
  for(let i=1;i<=5;i++){
    const s=document.getElementById('sv-wizard-step-'+i);
    if(!s)continue;
    if(i===n){
      s.style.display='block';s.style.opacity='0';s.style.transform='translateX(20px)';
      requestAnimationFrame(function(){const el=s;return function(){el.style.transition='opacity 0.3s ease,transform 0.3s ease';el.style.opacity='1';el.style.transform='translateX(0)';setTimeout(function(){el.style.transition='';},300);};}());
    } else {
      s.style.display='none';s.style.opacity='';s.style.transform='';
    }
  }
  svRenderStepIndicator(n);
  if(n===1)svRenderGradeSelect();
  if(n===2)svRenderClassCards();
  if(n===3)svRenderLangSelect();
  if(n===4)svRenderQuestionEditor();
  if(n===5)svRenderComplete();
}

function svRenderLangSelect(){
  const el=document.getElementById('sv-wizard-step-3');if(!el)return;
  const langs=[
    {code:'ko',name:'한국어',flag:_FLAG_KO},
    {code:'en',name:'영어 (English)',flag:'🇺🇸'},
    {code:'ru',name:'러시아어 (Русский)',flag:'🇷🇺'},
    {code:'vi',name:'베트남어 (Tiếng Việt)',flag:'🇻🇳'},
    {code:'km',name:'캄보디아어 (ភាសាខ្មែរ)',flag:_FLAG_KM},
    {code:'th',name:'태국어 (ภาษาไทย)',flag:'🇹🇭'},
    {code:'tl',name:'필리핀어 (Filipino)',flag:'🇵🇭'},
    {code:'zh',name:'중국어 (中文)',flag:_FLAG_CN},
    {code:'ja',name:'일본어 (日本語)',flag:'🇯🇵'},
    {code:'mn',name:'몽골어 (Монгол)',flag:_FLAG_MN},
    {code:'ne',name:'네팔어 (नेपाली)',flag:'🇳🇵'},
    {code:'id',name:'인도네시아어 (Bahasa)',flag:'🇮🇩'},
    {code:'ar',name:'아랍어 (العربية)',flag:_FLAG_SA},
    {code:'ur',name:'우르두어 (اردو)',flag:'🇵🇰'},
    {code:'es',name:'스페인어 (Español)',flag:_FLAG_ES}
  ];
  let h='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="font-size:14px;font-weight:700;color:var(--t1)">설문 언어를 선택하세요</div><div style="display:flex;gap:8px"><button class="sv-btn" data-sv-click="wizardStep" data-sv-step="2">← 이전</button><button class="sv-btn-primary" data-sv-click="wizardStep" data-sv-step="4">다음 →</button></div></div>';
  h+='<p style="font-size:11px;color:var(--t3);margin-bottom:14px">한국어는 기본 선택입니다. 다국어 설문이 필요한 경우 추가 언어를 선택하세요.</p>';
  h+='<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">';
  langs.forEach(function(l){
    const sel=svWizardSelectedLangs.indexOf(l.code)!==-1;
    const isKo=l.code==='ko';
    h+='<div class="sv-lang-card'+(sel?' selected':'')+'" data-lang="'+l.code+'"'+(isKo?'':' data-sv-click="toggleLang"')+' style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 10px;border:2px solid '+(sel?'var(--cyan)':'var(--bdr)')+';border-radius:10px;background:'+(sel?'rgba(6,182,212,0.08)':'var(--card)')+';cursor:'+(isKo?'default':'pointer')+';transition:all .15s;position:relative">';
    if(isKo)h+='<div style="position:absolute;top:6px;right:8px;font-size:9px;color:var(--cyan);font-weight:700">기본</div>';
    h+='<span style="font-size:32px;line-height:1">'+l.flag+'</span>';
    h+='<span style="font-size:12px;font-weight:700;color:'+(sel?'var(--cyan)':'var(--t1)')+'">'+l.name+'</span>';
    h+='</div>';
  });
  h+='</div>';
  el.innerHTML=h;
  /* lang card 클릭 이벤트 바인딩 */
  el.querySelectorAll('[data-sv-click="toggleLang"]').forEach(function(card){
    card.addEventListener('click', function(){ svToggleLang(card.dataset.lang, card); });
  });
}
function svToggleLang(code,card){
  const idx=svWizardSelectedLangs.indexOf(code);
  if(idx===-1){svWizardSelectedLangs.push(code);}else{svWizardSelectedLangs.splice(idx,1);}
  const sel=idx===-1;
  _uiApplyLangCardState(card,sel);
}

function svRenderGradeSelect(){
  const el=document.getElementById('sv-wizard-step-1');if(!el)return;
  const stuList=S.people.filter(function(s){return s.type==='student';});
  const grades=_wizGetSelectableGrades(S.people);
  const sl=S.settings.schoolLevel||'elementary';
  let h='<div class="cc" style="padding:20px"><div style="font-size:14px;font-weight:700;color:var(--t1);margin-bottom:14px">설문 대상 학년을 선택하세요.</div>';
  h+='<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">';
  h+='<label style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--cyan);border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;color:var(--t1);background:rgba(6,182,212,0.06);transition:all .15s;margin-right:12px"><input type="checkbox" id="svGradeAll" data-sv-change="toggleAllGrades"> 전체 선택</label>';
  const gradeCards=_vmBuildGradeCards(grades,S.people,sl);
  gradeCards.forEach(function(card){
    h+='<label style="display:flex;align-items:center;gap:6px;padding:8px 16px;border:1px solid var(--bdr);border-radius:8px;cursor:pointer;font-size:12px;color:var(--t2);background:var(--bg2);transition:all .15s" class="sv-grade-label-hover">'
      +'<input type="checkbox" class="sv-grade-cb" value="'+card.grade+'" data-sv-change="updateGradeSelection"> '+card.label+'<span style="font-size:10px;color:var(--t3)">('+card.count+'명)</span></label>';
  });
  h+='<button class="sv-btn-primary" id="svStep1Next" data-sv-click="goStep2" disabled style="opacity:0.5;margin-left:12px">다음 →</button>';
  h+='</div></div>';
  el.innerHTML=h;
}

function svToggleAllGrades(el){
  document.querySelectorAll('.sv-grade-cb').forEach(function(cb){cb.checked=el.checked;});
  svUpdateGradeSelection();
  if(el.checked)setTimeout(function(){svGoStep2();},300);
}
function svUpdateGradeSelection(){
  const cbs=document.querySelectorAll('.sv-grade-cb:checked');
  const totalCbs=document.querySelectorAll('.sv-grade-cb');
  const btn=document.getElementById('svStep1Next');
  const all=document.getElementById('svGradeAll');
  _uiApplyGradeSelectionUi(btn,all,cbs.length,totalCbs.length);
  if(cbs.length===totalCbs.length&&totalCbs.length>0){setTimeout(function(){svGoStep2();},300);}
}
function svGoStep2(){
  svWizardSelectedGrades=_wizCollectSelectedGrades(document.querySelectorAll('.sv-grade-cb:checked'));
  if(!svWizardSelectedGrades.length)return;
  svWizardStep(2);
}

function svIsCare(s){
  if(!s||s.type!=='student')return false;
  if(!(s.status==='caution'||s.status==='watch'))return false;
  return true;
}
function svCareLabel(s){
  if(!svIsCare(s))return '';
  const curYear=_academicYear();
  return(s.careYear&&s.careYear<curYear)?'전년도 요보호':'요보호';
}
function svRenderClassCards(){
  const el=document.getElementById('sv-wizard-step-2');if(!el)return;
  const groups=_wizBuildClassGroups(S.people,svWizardSelectedGrades);
  const keys=Object.keys(groups).sort();
  const sl=S.settings.schoolLevel||'elementary';
  let h='<div style="position:sticky;top:0;z-index:10;background:var(--bg);padding:10px 0 14px;display:flex;align-items:center;justify-content:space-between"><div style="font-size:14px;font-weight:700;color:var(--t1)">반/학생을 선택하세요.</div><div style="display:flex;gap:8px"><button class="sv-btn" data-sv-click="wizardStep" data-sv-step="1">← 이전</button><button class="sv-btn-primary" data-sv-click="wizardStep" data-sv-step="3">다음 →</button></div></div>';
  h+='<div class="sv-class-list" style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding-right:0;padding-bottom:150px;scrollbar-width:none">';
  const classCards=_vmBuildClassCardModels(groups,sl,svWizardSelectedStudents,svCareLabel,svIsCare);
  classCards.forEach(function(g){
    h+='<div class="sv-class-card" style="border:1px solid var(--bdr);border-radius:8px;padding:10px 12px;background:var(--bg2)">' 
      +'<div style="display:flex;align-items:center;margin-bottom:6px">'
      +'<div style="font-size:12px;font-weight:700;color:var(--cyan)">'+g.title+' ('+g.count+'명)</div>'
      +'<label style="font-size:10px;color:var(--t2);cursor:pointer;display:flex;align-items:center;gap:4px;margin-left:8px"><input type="checkbox" checked class="sv-cls-all" data-key="'+g.key+'"> 전체 선택</label></div>';
    h+='<div style="display:flex;flex-wrap:wrap;gap:4px">';
    g.people.forEach(function(s){
      const sid=s.id;
      if(!svWizardSelectedStudents.hasOwnProperty(sid))svWizardSelectedStudents[sid]=true;
      h+='<span class="sv-student-chip '+(s.checked?'checked':'unchecked')+'" data-sid="'+sid+'" data-cls="'+g.key+'" data-sv-click="toggleStudent" data-sv-sid="'+sid+'">'
        +s.num+'번 '+s.name+(s.care?' <span style="font-size:9px;color:var(--yl)">*'+s.careLabel+'*</span>':'')+'</span>';
    });
    h+='</div></div>';
  });
  h+='</div>';
  el.innerHTML=h;
  /* 전체 선택 체크박스 이벤트 바인딩 */
  el.querySelectorAll('.sv-cls-all').forEach(function(cb){
    cb.addEventListener('change', function(){ svToggleClass(cb.dataset.key, cb); });
  });
}

function svToggleClass(key,el){
  const chips=document.querySelectorAll('.sv-student-chip[data-cls="'+key+'"]');
  _wizApplyClassSelection(svWizardSelectedStudents,chips,el.checked);
  chips.forEach(function(c){c.className='sv-student-chip '+(el.checked?'checked':'unchecked');});
}
function svToggleStudent(sid,chip){
  const sel=_wizToggleStudentSelection(svWizardSelectedStudents,sid);
  chip.className='sv-student-chip '+(sel?'checked':'unchecked');
  const cls=chip.dataset.cls;
  const all=document.querySelector('.sv-cls-all[data-key="'+cls+'"]');
  if(all){
    const chips=document.querySelectorAll('.sv-student-chip[data-cls="'+cls+'"]');
    const allChecked=_wizAreAllClassStudentsSelected(svWizardSelectedStudents,chips);
    all.checked=allChecked;
  }
}

const SV_QTYPES={short_text:'주관식(단답형)',paragraph:'주관식(서술형)',radio:'객관식(선택)',dropdown:'객관식(드롭다운)',checkbox:'객관식(체크박스)',grid_radio:'그리드(객관식)',grid_text:'그리드(주관식)',star:'등급(별표)',scale:'등급(선형배율)',date_cal:'날짜(달력)',date_text:'날짜(숫자쓰기)',time_clock:'시간(시계)',time_text:'시간(숫자쓰기)'};
let svSurveyData=null;
/* ── 설문 종료 확인 다국어 ── */
const SV_END_CONFIRM={
  question:{ko:'설문을 마치시겠습니까?',en:'Would you like to end the survey?',ru:'Хотите ли вы завершить опрос?',vi:'Bạn có muốn kết thúc khảo sát không?',km:'តើអ្នកចង់បញ្ចប់ការស្ទង់មតិទេ?',th:'คุณต้องการสิ้นสุดแบบสำรวจหรือไม่?',tl:'Gusto mo bang tapusin ang survey?',zh:'您是否要结束问卷调查？',ja:'アンケートを終了しますか？'},
  yes:{ko:'예',en:'Yes',ru:'Да',vi:'Có',km:'បាទ/ចាស',th:'ใช่',tl:'Oo',zh:'是',ja:'はい'},
  no:{ko:'아니오',en:'No',ru:'Нет',vi:'Không',km:'ទេ',th:'ไม่',tl:'Hindi',zh:'否',ja:'いいえ'}
};

function svInitSurveyData(){
  const _svAlreadyLoaded=!!svSurveyData;
  if(!_svAlreadyLoaded){
    svSurveyData=_dbLoadLocalDraft();
  }
  if(!_svAlreadyLoaded){
    _dbLoadBackendDraft().then(function(draft){
      if(draft&&!svSurveyData){svSurveyData=draft;_dbPersistLocalDraft(svSurveyData);}
    }).catch(function(){});
  }
  if(!svSurveyData){
    const school=S.settings.schoolName||'OO고등학교';
    const yr=new Date().getFullYear();
    _dbLoadDefaultDraft(school,yr).then(function(draft){
      if(draft&&!svSurveyData){svSurveyData=draft;_svApplyTranslations();svRenderQuestionEditor();}
    }).catch(function(err){console.error('[ERROR] loadDefaultDraft',err);});
    return;
  }
  _svApplyTranslations();
}
function _svApplyTranslations(){
  if(!svSurveyData||!svSurveyData.sections) return;
  /* 번역에서 사용하는 변수 */
  const school=S.settings.schoolName||'OO고등학교';
  const nextYr=new Date().getFullYear()+1;const retentionDate=nextYr+'-02-'+new Date(nextYr,2,0).getDate();
  /* ── 동의 섹션 기본 다국어 번역 설정 (항상 실행 — 캐시에서 불러온 경우에도 최신 번역 적용) ── */
  const _s1=svSurveyData.sections[0]; /* 개인정보 */
  const _s2=svSurveyData.sections[1]; /* 민감정보 */
  const _s3=svSurveyData.sections[2]; /* 응급처치 */
  if(!_s1.titleTranslations) _s1.titleTranslations={};
  if(!_s2.titleTranslations) _s2.titleTranslations={};
  if(!_s3.titleTranslations) _s3.titleTranslations={};
  if(!_s1.descTranslations) _s1.descTranslations={};
  if(!_s2.descTranslations) _s2.descTranslations={};
  if(!_s3.descTranslations) _s3.descTranslations={};
  if(!_s1.questions[0].translations) _s1.questions[0].translations={};
  if(!_s2.questions[0].translations) _s2.questions[0].translations={};
  if(!_s3.questions[0].translations) _s3.questions[0].translations={};
  /* s1 타이틀 */
  _s1.titleTranslations.en='Consent to Collection and Use of Personal Information';
  _s1.titleTranslations.ru='Согласие на сбор и использование персональных данных';
  _s1.titleTranslations.vi='Đồng ý thu thập và sử dụng thông tin cá nhân';
  _s1.titleTranslations.km='ការយល់ព្រមក្នុងការប្រមូល និងប្រើប្រាស់ព័ត៌មានផ្ទាល់ខ្លួន';
  _s1.titleTranslations.th='ความยินยอมในการเก็บรวบรวมและใช้ข้อมูลส่วนบุคคล';
  _s1.titleTranslations.tl='Pahintulot sa Pangongolekta at Paggamit ng Personal na Impormasyon';
  _s1.titleTranslations.zh='个人信息收集与使用同意书';
  _s1.titleTranslations.ja='個人情報の収集・利用に関する同意';
  _s1.titleTranslations.mn='Хувийн мэдээлэл цуглуулах, ашиглахыг зөвшөөрөх';
  _s1.titleTranslations.ne='व्यक्तिगत जानकारी सङ्कलन तथा प्रयोग सहमति';
  _s1.titleTranslations.id='Persetujuan Pengumpulan dan Penggunaan Informasi Pribadi';
  _s1.titleTranslations.ar='الموافقة على جمع واستخدام المعلومات الشخصية';
  _s1.titleTranslations.ur='ذاتی معلومات کی جمع اور استعمال کی رضامندی';
  _s1.titleTranslations.es='Consentimiento para la Recopilación y Uso de Información Personal';
  /* s2 타이틀 */
  _s2.titleTranslations.en='Consent to Collection and Use of Sensitive Information';
  _s2.titleTranslations.ru='Согласие на сбор и использование конфиденциальной информации';
  _s2.titleTranslations.vi='Đồng ý thu thập và sử dụng thông tin nhạy cảm';
  _s2.titleTranslations.km='ការយល់ព្រមក្នុងការប្រមូល និងប្រើប្រាស់ព័ត៌មានរសើប';
  _s2.titleTranslations.th='ความยินยอมในการเก็บรวบรวมและใช้ข้อมูลที่มีความอ่อนไหว';
  _s2.titleTranslations.tl='Pahintulot sa Pangongolekta at Paggamit ng Sensitibong Impormasyon';
  _s2.titleTranslations.zh='敏感信息收集与使用同意书';
  _s2.titleTranslations.ja='機微情報の収集・利用に関する同意';
  _s2.titleTranslations.mn='Эмзэг мэдээлэл цуглуулах, ашиглахыг зөвшөөрөх';
  _s2.titleTranslations.ne='संवेदनशील जानकारी सङ्कलन तथा प्रयोग सहमति';
  _s2.titleTranslations.id='Persetujuan Pengumpulan dan Penggunaan Informasi Sensitif';
  _s2.titleTranslations.ar='الموافقة على جمع واستخدام المعلومات الحساسة';
  _s2.titleTranslations.ur='حساس معلومات کی جمع اور استعمال کی رضامندی';
  _s2.titleTranslations.es='Consentimiento para la Recopilación y Uso de Información Sensible';
  /* s3 타이틀 */
  _s3.titleTranslations.en='Consent to Emergency Medical Treatment';
  _s3.titleTranslations.ru='Согласие на оказание экстренной медицинской помощи';
  _s3.titleTranslations.vi='Đồng ý sơ cứu khẩn cấp';
  _s3.titleTranslations.km='ការយល់ព្រមលើការសង្គ្រោះបន្ទាន់';
  _s3.titleTranslations.th='ความยินยอมในการปฐมพยาบาลฉุกเฉิน';
  _s3.titleTranslations.tl='Pahintulot sa Emergency na Pangunang Lunas';
  _s3.titleTranslations.zh='急救处置同意书';
  _s3.titleTranslations.ja='応急処置に関する同意';
  _s3.titleTranslations.mn='Яаралтай тусламжийн зөвшөөрөл';
  _s3.titleTranslations.ne='आपतकालीन उपचार सहमति';
  _s3.titleTranslations.id='Persetujuan Pertolongan Pertama Darurat';
  _s3.titleTranslations.ar='الموافقة على الإسعافات الأولية الطارئة';
  _s3.titleTranslations.ur='ہنگامی ابتدائی طبی امداد کی رضامندی';
  _s3.titleTranslations.es='Consentimiento para Tratamiento Médico de Emergencia';
  /* s1 desc (개인정보) */
  _s1.descTranslations.en=school+' collects and uses personal information, or provides it to third parties, with the consent of the individual in accordance with Articles 15, 17, 23, and 24 of the Personal Information Protection Act. Our school collects only the minimum necessary information for the purpose of student health management and life guidance, and does not use it for any other purpose. Confidentiality is absolutely guaranteed pursuant to Article 7 of the School Health Act and Article 3 of the Emergency Medical Service Act. In addition, resident registration numbers are not processed unless specifically required or permitted by law. Please read the following carefully and decide whether to consent after understanding all contents.\n\nA. Purpose of collecting and using personal information\n - To assess health habits and physical/mental health status of growing students\n - To contribute to early detection, treatment, and a healthy life\n - Emergency treatment, handover to parents, and transport via 119 rescue services\n - To devise appropriate measures such as education, health counseling, treatment, and protection for students with health concerns\n\nB. Items of personal information collected\n - Student class/number/name/gender/contact information, guardian name/contact information/relationship to student\n\nC. Retention period: '+retentionDate+' (destroyed without delay after the retention period)\n\nD. Right to refuse consent to personal information collection\n - You may refuse to consent to the collection and use of personal information. Even if you refuse, the student may continue school life; however, failure to consent may hinder the student from receiving appropriate health protection and response.';
  _s1.descTranslations.ru=school+' осуществляет сбор и использование персональных данных или предоставляет их третьим лицам с согласия субъекта данных в соответствии со статьями 15, 17, 23 и 24 Закона о защите персональных данных. Наша школа собирает только минимально необходимую информацию в целях управления здоровьем учащихся и руководства повседневной жизнью и не использует её в иных целях. Конфиденциальность абсолютно гарантирована в соответствии со статьёй 7 Закона о школьном здравоохранении и статьёй 3 Закона о скорой медицинской помощи. Кроме того, регистрационные номера граждан не обрабатываются, за исключением случаев, когда это прямо предусмотрено или разрешено законом. Пожалуйста, внимательно прочитайте приведённую ниже информацию и примите решение о согласии после полного понимания всего содержания.\n\nА. Цели сбора и использования персональных данных\n - Оценка привычек здорового образа жизни и физического/психического состояния здоровья растущих учащихся\n - Содействие раннему выявлению, лечению и здоровой жизни\n - Оказание экстренной помощи, передача родителям и транспортировка службой спасения 119\n - Разработка соответствующих мер, таких как обучение, консультации по здоровью, лечение и защита учащихся с проблемами со здоровьем\n\nБ. Собираемые персональные данные\n - Класс/номер/имя/пол/контактные данные учащегося, имя/контактные данные/степень родства опекуна\n\nВ. Срок хранения: '+retentionDate+' (уничтожается без задержки по истечении срока хранения)\n\nГ. Право на отказ от согласия на сбор персональных данных\n - Вы можете отказаться от согласия на сбор и использование персональных данных. Даже в случае отказа учащийся может продолжать школьную жизнь, однако отсутствие согласия может помешать учащемуся получить надлежащую защиту здоровья и реагирование.';
  _s1.descTranslations.vi=school+' thu thập và sử dụng thông tin cá nhân, hoặc cung cấp cho bên thứ ba, với sự đồng ý của cá nhân theo Điều 15, 17, 23 và 24 của Luật Bảo vệ Thông tin Cá nhân. Trường chúng tôi chỉ thu thập thông tin tối thiểu cần thiết cho mục đích quản lý sức khỏe học sinh và hướng dẫn sinh hoạt, và không sử dụng cho bất kỳ mục đích nào khác. Tính bảo mật được đảm bảo tuyệt đối theo Điều 7 Luật Sức khỏe Học đường và Điều 3 Luật Dịch vụ Y tế Khẩn cấp. Ngoài ra, số đăng ký cư trú không được xử lý trừ khi pháp luật yêu cầu hoặc cho phép cụ thể. Xin vui lòng đọc kỹ nội dung dưới đây và quyết định đồng ý sau khi hiểu rõ tất cả nội dung.\n\nA. Mục đích thu thập và sử dụng thông tin cá nhân\n - Đánh giá thói quen sức khỏe và tình trạng sức khỏe thể chất/tinh thần của học sinh đang phát triển\n - Góp phần phát hiện sớm, điều trị và cuộc sống khỏe mạnh\n - Sơ cứu, bàn giao cho phụ huynh và vận chuyển qua dịch vụ cứu hộ 119\n - Đề ra các biện pháp thích hợp như giáo dục, tư vấn sức khỏe, điều trị và bảo vệ học sinh có vấn đề sức khỏe\n\nB. Các hạng mục thông tin cá nhân thu thập\n - Lớp/số thứ tự/họ tên/giới tính/thông tin liên lạc của học sinh, họ tên/thông tin liên lạc/quan hệ với học sinh của người giám hộ\n\nC. Thời hạn lưu trữ: '+retentionDate+' (hủy ngay sau khi hết thời hạn lưu trữ)\n\nD. Quyền từ chối đồng ý thu thập thông tin cá nhân\n - Quý vị có quyền từ chối đồng ý thu thập và sử dụng thông tin cá nhân. Ngay cả khi từ chối, học sinh vẫn có thể tiếp tục sinh hoạt tại trường; tuy nhiên, việc không đồng ý có thể ảnh hưởng đến việc học sinh nhận được sự bảo vệ và ứng phó sức khỏe phù hợp.';
  _s1.descTranslations.km=school+' ប្រមូល និងប្រើប្រាស់ព័ត៌មានផ្ទាល់ខ្លួន ឬផ្តល់ជូនភាគីទីបី ដោយមានការយល់ព្រមពីបុគ្គលពាក់ព័ន្ធ ស្របតាមប្រការ 15, 17, 23 និង 24 នៃច្បាប់ការពារព័ត៌មានផ្ទាល់ខ្លួន។ សាលារៀនរបស់យើងប្រមូលតែព័ត៌មានអប្បបរមាចាំបាច់សម្រាប់គោលបំណងគ្រប់គ្រងសុខភាពសិស្ស និងការណែនាំក្នុងជីវិតប្រចាំថ្ងៃ ហើយមិនប្រើប្រាស់សម្រាប់គោលបំណងផ្សេងទេ។ ការសម្ងាត់ត្រូវបានធានាទាំងស្រុងស្របតាមប្រការ 7 នៃច្បាប់សុខភាពសាលារៀន និងប្រការ 3 នៃច្បាប់សេវាវេជ្ជសាស្ត្រសង្គ្រោះបន្ទាន់។ លើសពីនេះ លេខចុះឈ្មោះអត្រានុកូលដ្ឋានមិនត្រូវបានដំណើរការទេ លើកលែងតែមានការតម្រូវ ឬអនុញ្ញាតជាក់លាក់ដោយច្បាប់។ សូមអានព័ត៌មានខាងក្រោមដោយយកចិត្តទុកដាក់ ហើយសម្រេចចិត្តអំពីការយល់ព្រមបន្ទាប់ពីយល់ដឹងពីខ្លឹមសារទាំងអស់។\n\nក. គោលបំណងនៃការប្រមូល និងប្រើប្រាស់ព័ត៌មានផ្ទាល់ខ្លួន\n - វាយតម្លៃទម្លាប់សុខភាព និងស្ថានភាពសុខភាពរាងកាយ/ផ្លូវចិត្តរបស់សិស្សកំពុងលូតលាស់\n - រួមចំណែកក្នុងការរកឃើញដំបូង ការព្យាបាល និងជីវិតដែលមានសុខភាពល្អ\n - ការសង្គ្រោះបន្ទាន់ ការប្រគល់ជូនមាតាបិតា និងការដឹកជញ្ជូនតាមរយៈក្រុមសង្គ្រោះ 119\n - រៀបចំវិធានការសមស្រប ដូចជាការអប់រំ ការពិគ្រោះសុខភាព ការព្យាបាល និងការការពារសិស្សដែលមានបញ្ហាសុខភាព\n\nខ. ធាតុព័ត៌មានផ្ទាល់ខ្លួនដែលប្រមូល\n - ថ្នាក់/លេខ/ឈ្មោះ/ភេទ/ព័ត៌មានទំនាក់ទំនងរបស់សិស្ស ឈ្មោះ/ព័ត៌មានទំនាក់ទំនង/ទំនាក់ទំនងជាមួយសិស្សរបស់អាណាព្យាបាល\n\nគ. រយៈពេលរក្សាទុក: '+retentionDate+' (បំផ្លាញភ្លាមៗបន្ទាប់ពីផុតរយៈពេលរក្សាទុក)\n\nឃ. សិទ្ធិក្នុងការបដិសេធការយល់ព្រមលើការប្រមូលព័ត៌មានផ្ទាល់ខ្លួន\n - លោក/លោកស្រីអាចបដិសេធការយល់ព្រមលើការប្រមូល និងប្រើប្រាស់ព័ត៌មានផ្ទាល់ខ្លួន។ ទោះបីជាបដិសេធក៏ដោយ សិស្សនៅតែអាចបន្តរៀននៅសាលា ប៉ុន្តែការមិនយល់ព្រមអាចរារាំងសិស្សពីការទទួលបានការការពារ និងការឆ្លើយតបសុខភាពសមរម្យ។';
  _s1.descTranslations.th=school+' ดำเนินการเก็บรวบรวมและใช้ข้อมูลส่วนบุคคล หรือให้ข้อมูลแก่บุคคลที่สาม โดยได้รับความยินยอมจากเจ้าของข้อมูลตามมาตรา 15, 17, 23 และ 24 ของพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล โรงเรียนของเราเก็บรวบรวมเฉพาะข้อมูลที่จำเป็นขั้นต่ำเพื่อวัตถุประสงค์ในการจัดการสุขภาพนักเรียนและการแนะแนวชีวิต และไม่ใช้เพื่อวัตถุประสงค์อื่นใด ความเป็นความลับได้รับการรับรองอย่างสมบูรณ์ตามมาตรา 7 ของพระราชบัญญัติสุขภาพโรงเรียน และมาตรา 3 ของพระราชบัญญัติบริการการแพทย์ฉุกเฉิน นอกจากนี้ หมายเลขทะเบียนราษฎร์จะไม่ถูกประมวลผล เว้นแต่กฎหมายกำหนดหรืออนุญาตไว้โดยเฉพาะ กรุณาอ่านข้อมูลต่อไปนี้อย่างละเอียดและตัดสินใจให้ความยินยอมหลังจากเข้าใจเนื้อหาทั้งหมดแล้ว\n\nก. วัตถุประสงค์ในการเก็บรวบรวมและใช้ข้อมูลส่วนบุคคล\n - ประเมินพฤติกรรมสุขภาพและสถานะสุขภาพกาย/จิตของนักเรียนที่กำลังเติบโต\n - มีส่วนในการตรวจพบเร็ว การรักษา และการมีชีวิตที่มีสุขภาพดี\n - การปฐมพยาบาล การส่งมอบให้ผู้ปกครอง และการขนส่งผ่านหน่วยกู้ภัย 119\n - วางมาตรการที่เหมาะสม เช่น การศึกษา การให้คำปรึกษาด้านสุขภาพ การรักษา และการคุ้มครองนักเรียนที่มีปัญหาสุขภาพ\n\nข. รายการข้อมูลส่วนบุคคลที่เก็บรวบรวม\n - ชั้นเรียน/เลขที่/ชื่อ/เพศ/ข้อมูลติดต่อของนักเรียน ชื่อ/ข้อมูลติดต่อ/ความสัมพันธ์กับนักเรียนของผู้ปกครอง\n\nค. ระยะเวลาเก็บรักษา: '+retentionDate+' (ทำลายทันทีหลังสิ้นสุดระยะเวลาเก็บรักษา)\n\nง. สิทธิในการปฏิเสธความยินยอมในการเก็บรวบรวมข้อมูลส่วนบุคคล\n - ท่านสามารถปฏิเสธความยินยอมในการเก็บรวบรวมและใช้ข้อมูลส่วนบุคคลได้ แม้จะปฏิเสธ นักเรียนยังสามารถใช้ชีวิตในโรงเรียนได้ แต่การไม่ยินยอมอาจส่งผลให้นักเรียนไม่ได้รับการคุ้มครองและการดูแลสุขภาพที่เหมาะสม';
  _s1.descTranslations.tl=school+' ay nangongolekta at gumagamit ng personal na impormasyon, o nagbibigay nito sa mga ikatlong partido, nang may pahintulot ng indibidwal alinsunod sa Artikulo 15, 17, 23, at 24 ng Batas sa Proteksyon ng Personal na Impormasyon. Ang aming paaralan ay nangongolekta lamang ng pinakakaunting kinakailangang impormasyon para sa layunin ng pamamahala ng kalusugan ng mag-aaral at patnubay sa pamumuhay, at hindi ginagamit ito para sa anumang ibang layunin. Ang pagiging kumpidensyal ay ganap na ginagarantiyahan alinsunod sa Artikulo 7 ng Batas sa Kalusugan ng Paaralan at Artikulo 3 ng Batas sa Serbisyong Medikal na Pang-emerhensya. Bukod dito, ang mga numero ng pagpaparehistro ng residente ay hindi pinoproseso maliban kung partikular na kinakailangan o pinapayagan ng batas. Mangyaring basahin nang mabuti ang sumusunod na impormasyon at magpasya kung papayag pagkatapos maunawaan ang lahat ng nilalaman.\n\nA. Layunin ng pangongolekta at paggamit ng personal na impormasyon\n - Suriin ang mga gawi sa kalusugan at pisikal/mental na kalagayan ng mga lumalaking mag-aaral\n - Mag-ambag sa maagang pagtuklas, paggamot, at malusog na pamumuhay\n - Pangunang lunas sa emerhensya, pag-turnover sa mga magulang, at transportasyon sa pamamagitan ng 119 rescue services\n - Magbalangkas ng naaangkop na mga hakbang tulad ng edukasyon, pagpapayo sa kalusugan, paggamot, at proteksyon para sa mga mag-aaral na may mga problema sa kalusugan\n\nB. Mga item ng personal na impormasyong kinokolekta\n - Klase/numero/pangalan/kasarian/impormasyon sa pakikipag-ugnayan ng mag-aaral, pangalan/impormasyon sa pakikipag-ugnayan/kaugnayan sa mag-aaral ng tagapangalaga\n\nC. Panahon ng pagpapanatili: '+retentionDate+' (sinisira kaagad pagkatapos ng panahon ng pagpapanatili)\n\nD. Karapatan na tanggihan ang pahintulot sa pangongolekta ng personal na impormasyon\n - Maaari kayong tumanggi na pumayag sa pangongolekta at paggamit ng personal na impormasyon. Kahit tumanggi, maaari pa ring magpatuloy ang mag-aaral sa buhay-paaralan; gayunpaman, ang hindi pagpayag ay maaaring makahadlang sa mag-aaral na makatanggap ng naaangkop na proteksyon at tugon sa kalusugan.';
  _s1.descTranslations.zh=school+'依据《个人信息保护法》第15条、第17条、第23条及第24条的规定，在收集、使用个人信息或向第三方提供时，须征得本人同意。本校仅为学生健康管理及生活指导目的收集最少量的必要信息，不会将其用于其他目的。依据《学校保健法》第7条和《急救医疗相关法律》第3条，绝对保障信息保密。此外，除非法律明确要求或允许处理居民身份证号码，否则不予处理。请仔细阅读以下内容，在充分理解所有内容后再决定是否同意。\n\n一、个人信息收集与使用目的\n - 了解成长期学生的健康生活习惯及身体、心理健康状况\n - 为早期发现、治疗等健康生活做出贡献\n - 急救处置、移交家长及通过119急救队转送\n - 对有健康问题的学生采取适当措施，如教育、健康咨询、治疗及保护\n\n二、收集的个人信息项目\n - 学生班级/学号/姓名/性别/联系方式，监护人姓名/联系方式/与学生的关系\n\n三、保留期限：'+retentionDate+'（保留期限届满后立即销毁）\n\n四、拒绝同意收集个人信息的权利\n - 您可以拒绝同意收集和使用个人信息。即使拒绝同意，学生仍可继续在校学习生活，但因未同意可能导致学生在健康保护和应对方面受到影响。';
  _s1.descTranslations.ja=school+'は「個人情報保護法」第15条、第17条、第23条及び第24条に基づき、個人情報を収集・利用する場合、または第三者に提供する場合には、本人の同意を得ております。本校は、学生の健康管理及び生活指導の目的で活用するために必要最小限の情報のみを収集し、当該目的以外には利用いたしません。「学校保健法」第7条及び「救急医療に関する法律」第3条に基づき、秘密は絶対に保障いたします。また、法令で具体的に住民登録番号の処理が要求または許可されている場合を除き、住民登録番号は処理いたしません。情報主体であるお客様におかれましては、以下の内容をよくお読みいただき、すべての内容をご理解の上、同意の可否をご判断ください。\n\nイ. 個人情報の収集・利用目的\n - 成長期の学生の健康生活習慣及び身体的・精神的健康状態の把握\n - 早期発見・治療等、健康な生活への貢献\n - 応急処置、保護者への引き渡し及び119救助隊による搬送\n - 健康上の問題がある学生に対する教育、健康相談、治療及び保護等の適切な対策の策定\n\nロ. 収集する個人情報の項目\n - 学生のクラス・番号・氏名・性別・連絡先、保護者の氏名・連絡先・学生との関係\n\nハ. 保有期間：'+retentionDate+'（保有期間終了後、速やかに破棄）\n\nニ. 個人情報収集同意拒否の権利\n - お客様は個人情報の収集・利用に同意しないことができます。同意を拒否された場合でも学生は学校生活を送ることができますが、不同意により健康上の適切な保護と対応を受ける際に支障が生じる場合があります。';
  _s1.descTranslations.mn=school+' нь Хувийн мэдээлэл хамгаалах тухай хуулийн 15, 17, 23, 24 дүгээр зүйлийн дагуу хувийн мэдээллийг цуглуулж, ашиглах эсвэл гуравдагч этгээдэд өгөхдөө мэдээлэл эзэмшигчийн зөвшөөрлийг авдаг. Манай сургууль зөвхөн сурагчдын эрүүл мэндийн менежмент болон амьдралын удирдамжийн зорилгоор шаардлагатай хамгийн бага мэдээллийг цуглуулж, бусад зорилгоор ашиглахгүй. Сургуулийн эрүүл мэндийн тухай хуулийн 7 дугаар зүйл болон Яаралтай тусламжийн тухай хуулийн 3 дугаар зүйлийн дагуу нууцлалыг бүрэн хангана. Мөн хуулиар тусгайлан заагаагүй бол иргэний бүртгэлийн дугаарыг боловсруулахгүй. Дараах мэдээллийг анхааралтай уншиж, бүх агуулгыг ойлгосны дараа зөвшөөрөх эсэхээ шийднэ үү.\n\nА. Хувийн мэдээлэл цуглуулах, ашиглах зорилго\n - Өсвөр насны сурагчдын эрүүл мэндийн зуршил, бие бялдар болон сэтгэцийн эрүүл мэндийн байдлыг тодорхойлох\n - Эрт илрүүлэх, эмчлэх, эрүүл амьдралд хувь нэмэр оруулах\n - Яаралтай тусламж үзүүлэх, эцэг эхэд шилжүүлэх, 119 аврах ангиар зөөвөрлөх\n - Эрүүл мэндийн асуудалтай сурагчдад боловсрол, эрүүл мэндийн зөвлөгөө, эмчилгээ, хамгаалалт зэрэг зохих арга хэмжээ авах\n\nБ. Цуглуулах хувийн мэдээллийн зүйл\n - Сурагчийн анги/дугаар/нэр/хүйс/холбоо барих мэдээлэл, асран хамгаалагчийн нэр/холбоо барих/сурагчтай харилцаа\n\nВ. Хадгалах хугацаа: '+retentionDate+' (хугацаа дуусмагц нэн даруй устгана)\n\nГ. Хувийн мэдээлэл цуглуулахыг зөвшөөрөхөөс татгалзах эрх\n - Та хувийн мэдээлэл цуглуулах, ашиглахыг зөвшөөрөхөөс татгалзаж болно. Татгалзсан ч сурагч сургуулийн амьдралаа үргэлжлүүлж болох боловч зөвшөөрөхгүй байсан тохиолдолд эрүүл мэндийн зохих хамгаалалт, арга хэмжээ авахад саад учирч болно.';
  _s1.descTranslations.ne=school+' ले व्यक्तिगत जानकारी संरक्षण ऐनको धारा 15, 17, 23 र 24 अनुसार व्यक्तिगत जानकारी सङ्कलन, प्रयोग वा तेस्रो पक्षलाई प्रदान गर्दा व्यक्तिको सहमति लिन्छ। हाम्रो विद्यालयले विद्यार्थीको स्वास्थ्य व्यवस्थापन र जीवन मार्गदर्शनको लागि न्यूनतम आवश्यक जानकारी मात्र सङ्कलन गर्छ र अन्य कुनै उद्देश्यका लागि प्रयोग गर्दैन। विद्यालय स्वास्थ्य ऐनको धारा 7 र आपतकालीन चिकित्सा सेवा ऐनको धारा 3 अनुसार गोपनीयता पूर्ण रूपमा सुनिश्चित गरिन्छ। साथै, कानूनले विशेष रूपमा आवश्यक नपारेसम्म बासिन्दा दर्ता नम्बर प्रशोधन गरिँदैन। कृपया निम्नलिखित जानकारी ध्यानपूर्वक पढ्नुहोस् र सबै विषयवस्तु बुझेपछि सहमति दिने वा नदिने निर्णय गर्नुहोस्।\n\nक. व्यक्तिगत जानकारी सङ्कलन र प्रयोगको उद्देश्य\n - बढ्दा विद्यार्थीहरूको स्वास्थ्य बानी र शारीरिक/मानसिक स्वास्थ्य अवस्था मूल्याङ्कन गर्न\n - प्रारम्भिक पहिचान, उपचार र स्वस्थ जीवनमा योगदान गर्न\n - आपतकालीन उपचार, अभिभावकलाई हस्तान्तरण र 119 उद्धार सेवाद्वारा ढुवानी\n - स्वास्थ्य समस्या भएका विद्यार्थीहरूका लागि शिक्षा, स्वास्थ्य परामर्श, उपचार र सुरक्षा जस्ता उचित उपायहरू तयार गर्न\n\nख. सङ्कलन गरिने व्यक्तिगत जानकारीका विषयहरू\n - विद्यार्थीको कक्षा/नम्बर/नाम/लिङ्ग/सम्पर्क जानकारी, अभिभावकको नाम/सम्पर्क जानकारी/विद्यार्थीसँगको सम्बन्ध\n\nग. भण्डारण अवधि: '+retentionDate+' (भण्डारण अवधि समाप्त भएपछि तुरुन्तै नष्ट गरिन्छ)\n\nघ. व्यक्तिगत जानकारी सङ्कलनमा सहमति अस्वीकार गर्ने अधिकार\n - तपाईं व्यक्तिगत जानकारी सङ्कलन र प्रयोगमा सहमति अस्वीकार गर्न सक्नुहुन्छ। अस्वीकार गरे पनि विद्यार्थीले विद्यालयको जीवन जारी राख्न सक्छन्; तर सहमति नदिँदा विद्यार्थीले उचित स्वास्थ्य सुरक्षा र प्रतिक्रिया प्राप्त गर्न बाधा हुन सक्छ।';
  _s1.descTranslations.id=school+' mengumpulkan dan menggunakan informasi pribadi, atau memberikannya kepada pihak ketiga, dengan persetujuan individu sesuai dengan Pasal 15, 17, 23, dan 24 Undang-Undang Perlindungan Informasi Pribadi. Sekolah kami hanya mengumpulkan informasi minimum yang diperlukan untuk tujuan pengelolaan kesehatan siswa dan bimbingan kehidupan, dan tidak menggunakannya untuk tujuan lain. Kerahasiaan dijamin sepenuhnya berdasarkan Pasal 7 Undang-Undang Kesehatan Sekolah dan Pasal 3 Undang-Undang Layanan Medis Darurat. Selain itu, nomor registrasi penduduk tidak diproses kecuali secara khusus diwajibkan atau diizinkan oleh undang-undang. Silakan baca informasi berikut dengan cermat dan putuskan apakah akan memberikan persetujuan setelah memahami semua isinya.\n\nA. Tujuan pengumpulan dan penggunaan informasi pribadi\n - Menilai kebiasaan kesehatan serta kondisi kesehatan fisik/mental siswa yang sedang bertumbuh\n - Berkontribusi pada deteksi dini, pengobatan, dan kehidupan yang sehat\n - Perawatan darurat, penyerahan kepada orang tua, dan transportasi melalui layanan penyelamatan 119\n - Menyusun langkah-langkah yang tepat seperti pendidikan, konseling kesehatan, pengobatan, dan perlindungan bagi siswa yang memiliki masalah kesehatan\n\nB. Item informasi pribadi yang dikumpulkan\n - Kelas/nomor/nama/jenis kelamin/informasi kontak siswa, nama/informasi kontak/hubungan dengan siswa dari wali\n\nC. Periode penyimpanan: '+retentionDate+' (segera dihancurkan setelah periode penyimpanan berakhir)\n\nD. Hak untuk menolak persetujuan pengumpulan informasi pribadi\n - Anda dapat menolak untuk menyetujui pengumpulan dan penggunaan informasi pribadi. Meskipun menolak, siswa tetap dapat melanjutkan kehidupan sekolah; namun, penolakan dapat menghambat siswa dalam menerima perlindungan dan respons kesehatan yang tepat.';
  _s1.descTranslations.ar=school+' تقوم بجمع واستخدام المعلومات الشخصية، أو تقديمها لأطراف ثالثة، بموافقة الفرد وفقاً للمواد 15 و17 و23 و24 من قانون حماية المعلومات الشخصية. تجمع مدرستنا فقط الحد الأدنى من المعلومات الضرورية لغرض إدارة صحة الطلاب والتوجيه الحياتي، ولا تستخدمها لأي غرض آخر. يتم ضمان السرية بشكل مطلق بموجب المادة 7 من قانون الصحة المدرسية والمادة 3 من قانون الخدمات الطبية الطارئة. علاوة على ذلك، لا تتم معالجة أرقام السجل المدني إلا إذا كان القانون يتطلب أو يسمح بذلك تحديداً. يرجى قراءة المعلومات التالية بعناية واتخاذ قرار الموافقة بعد فهم جميع المحتويات.\n\nأ. أغراض جمع واستخدام المعلومات الشخصية\n - تقييم العادات الصحية والحالة الصحية الجسدية والنفسية للطلاب في مرحلة النمو\n - المساهمة في الاكتشاف المبكر والعلاج والحياة الصحية\n - العلاج الطارئ وتسليم الطالب لأولياء الأمور والنقل عبر خدمات الإنقاذ 119\n - وضع التدابير المناسبة مثل التعليم والاستشارات الصحية والعلاج والحماية للطلاب الذين يعانون من مشاكل صحية\n\nب. بنود المعلومات الشخصية المجمعة\n - الصف/الرقم/الاسم/الجنس/معلومات الاتصال بالطالب، اسم ولي الأمر/معلومات الاتصال/العلاقة بالطالب\n\nج. مدة الاحتفاظ: '+retentionDate+' (يتم إتلافها فوراً بعد انتهاء مدة الاحتفاظ)\n\nد. الحق في رفض الموافقة على جمع المعلومات الشخصية\n - يمكنكم رفض الموافقة على جمع واستخدام المعلومات الشخصية. حتى في حالة الرفض، يمكن للطالب مواصلة الحياة المدرسية؛ ومع ذلك، قد يعيق عدم الموافقة حصول الطالب على الحماية والاستجابة الصحية المناسبة.';
  _s1.descTranslations.ur=school+' ذاتی معلومات کے تحفظ کے قانون کی دفعات 15، 17، 23 اور 24 کے مطابق فرد کی رضامندی سے ذاتی معلومات جمع کرتا ہے، استعمال کرتا ہے یا تیسرے فریق کو فراہم کرتا ہے۔ ہمارا اسکول صرف طلباء کی صحت کے انتظام اور زندگی کی رہنمائی کے مقصد کے لیے کم سے کم ضروری معلومات جمع کرتا ہے اور کسی دوسرے مقصد کے لیے استعمال نہیں کرتا۔ اسکول صحت قانون کی دفعہ 7 اور ایمرجنسی طبی خدمات قانون کی دفعہ 3 کے مطابق رازداری کی مکمل ضمانت دی جاتی ہے۔ مزید برآں، شہری رجسٹریشن نمبر پر عمل نہیں کیا جاتا جب تک قانون خاص طور پر اس کی ضرورت یا اجازت نہ دے۔ براہ کرم درج ذیل معلومات کو غور سے پڑھیں اور تمام مضامین سمجھنے کے بعد رضامندی دینے کا فیصلہ کریں۔\n\nالف۔ ذاتی معلومات جمع اور استعمال کا مقصد\n - بڑھتے ہوئے طلباء کی صحت کی عادات اور جسمانی/ذہنی صحت کی حالت کا جائزہ لینا\n - ابتدائی شناخت، علاج اور صحت مند زندگی میں حصہ ڈالنا\n - ہنگامی علاج، والدین کو حوالگی اور 119 ریسکیو سروسز کے ذریعے منتقلی\n - صحت کے مسائل والے طلباء کے لیے تعلیم، صحت مشاورت، علاج اور تحفظ جیسے مناسب اقدامات تیار کرنا\n\nب۔ جمع کی جانے والی ذاتی معلومات\n - طالب علم کی جماعت/نمبر/نام/جنس/رابطہ معلومات، سرپرست کا نام/رابطہ معلومات/طالب علم سے تعلق\n\nج۔ ذخیرہ کی مدت: '+retentionDate+' (ذخیرہ کی مدت ختم ہونے کے بعد فوری طور پر تلف کیا جائے گا)\n\nد۔ ذاتی معلومات جمع کرنے کی رضامندی سے انکار کا حق\n - آپ ذاتی معلومات کی جمع اور استعمال کی رضامندی سے انکار کر سکتے ہیں۔ انکار کی صورت میں بھی طالب علم اسکول کی زندگی جاری رکھ سکتا ہے؛ تاہم، رضامندی نہ دینے سے طالب علم کو مناسب صحت تحفظ اور ردعمل حاصل کرنے میں رکاوٹ ہو سکتی ہے۔';
  _s1.descTranslations.es=school+' recopila y utiliza información personal, o la proporciona a terceros, con el consentimiento del individuo de acuerdo con los Artículos 15, 17, 23 y 24 de la Ley de Protección de Información Personal. Nuestra escuela recopila únicamente la información mínima necesaria para la gestión de la salud estudiantil y la orientación de vida, y no la utiliza para ningún otro propósito. La confidencialidad está absolutamente garantizada conforme al Artículo 7 de la Ley de Salud Escolar y el Artículo 3 de la Ley de Servicios Médicos de Emergencia. Además, los números de registro civil no se procesan a menos que la ley lo requiera o permita específicamente. Por favor, lea la siguiente información detenidamente y decida si otorga su consentimiento después de comprender todo el contenido.\n\nA. Propósito de la recopilación y uso de información personal\n - Evaluar los hábitos de salud y el estado de salud física/mental de los estudiantes en crecimiento\n - Contribuir a la detección temprana, el tratamiento y una vida saludable\n - Tratamiento de emergencia, entrega a los padres y transporte mediante servicios de rescate 119\n - Diseñar medidas apropiadas como educación, asesoramiento de salud, tratamiento y protección para estudiantes con problemas de salud\n\nB. Elementos de información personal recopilados\n - Clase/número/nombre/género/información de contacto del estudiante, nombre/información de contacto/relación con el estudiante del tutor\n\nC. Período de conservación: '+retentionDate+' (se destruye sin demora tras finalizar el período de conservación)\n\nD. Derecho a rechazar el consentimiento para la recopilación de información personal\n - Usted puede rechazar el consentimiento para la recopilación y uso de información personal. Incluso si lo rechaza, el estudiante puede continuar su vida escolar; sin embargo, la falta de consentimiento puede impedir que el estudiante reciba la protección y respuesta de salud adecuadas.';
  /* s2 desc (민감정보) */
  _s2.descTranslations.en='A. Purpose of collecting and using sensitive information\n - Same as above\n\nB. Items of sensitive information collected\n - Information related to health (personal medical history, family medical history, vaccination history, physical and mental health status, health habits, etc.)\n\nC. Retention period: '+retentionDate+' (destroyed without delay after the retention period)\n\nD. Right to refuse consent to sensitive information collection\n - You may refuse to consent to the collection and use of sensitive information. Even if you refuse, the student may continue school life; however, failure to consent may hinder the student from receiving appropriate health protection and response.';
  _s2.descTranslations.ru='А. Цели сбора и использования конфиденциальной информации\n - Те же, что и выше\n\nБ. Собираемые конфиденциальные данные\n - Информация о здоровье (личная история болезни, семейный анамнез, история вакцинации, физическое и психическое состояние здоровья, привычки здорового образа жизни и т.д.)\n\nВ. Срок хранения: '+retentionDate+' (уничтожается без задержки по истечении срока хранения)\n\nГ. Право на отказ от согласия на сбор конфиденциальной информации\n - Вы можете отказаться от согласия на сбор и использование конфиденциальной информации. Даже в случае отказа учащийся может продолжать школьную жизнь, однако отсутствие согласия может помешать учащемуся получить надлежащую защиту здоровья и реагирование.';
  _s2.descTranslations.vi='A. Mục đích thu thập và sử dụng thông tin nhạy cảm\n - Giống như trên\n\nB. Các hạng mục thông tin nhạy cảm thu thập\n - Thông tin liên quan đến sức khỏe (tiền sử bệnh cá nhân, tiền sử gia đình, lịch sử tiêm chủng, tình trạng sức khỏe thể chất và tinh thần, thói quen sức khỏe, v.v.)\n\nC. Thời hạn lưu trữ: '+retentionDate+' (hủy ngay sau khi hết thời hạn lưu trữ)\n\nD. Quyền từ chối đồng ý thu thập thông tin nhạy cảm\n - Quý vị có quyền từ chối đồng ý thu thập và sử dụng thông tin nhạy cảm. Ngay cả khi từ chối, học sinh vẫn có thể tiếp tục sinh hoạt tại trường; tuy nhiên, việc không đồng ý có thể ảnh hưởng đến việc học sinh nhận được sự bảo vệ và ứng phó sức khỏe phù hợp.';
  _s2.descTranslations.km='ក. គោលបំណងនៃការប្រមូល និងប្រើប្រាស់ព័ត៌មានរសើប\n - ដូចខាងលើ\n\nខ. ធាតុព័ត៌មានរសើបដែលប្រមូល\n - ព័ត៌មានទាក់ទងនឹងសុខភាព (ប្រវត្តិជំងឺផ្ទាល់ខ្លួន ប្រវត្តិជំងឺគ្រួសារ ប្រវត្តិចាក់វ៉ាក់សាំង ស្ថានភាពសុខភាពរាងកាយ និងផ្លូវចិត្ត ទម្លាប់សុខភាព ។ល។)\n\nគ. រយៈពេលរក្សាទុក: '+retentionDate+' (បំផ្លាញភ្លាមៗបន្ទាប់ពីផុតរយៈពេលរក្សាទុក)\n\nឃ. សិទ្ធិក្នុងការបដិសេធការយល់ព្រមលើការប្រមូលព័ត៌មានរសើប\n - លោក/លោកស្រីអាចបដិសេធការយល់ព្រមលើការប្រមូល និងប្រើប្រាស់ព័ត៌មានរសើប។ ទោះបីជាបដិសេធក៏ដោយ សិស្សនៅតែអាចបន្តរៀននៅសាលា ប៉ុន្តែការមិនយល់ព្រមអាចរារាំងសិស្សពីការទទួលបានការការពារ និងការឆ្លើយតបសុខភាពសមរម្យ។';
  _s2.descTranslations.th='ก. วัตถุประสงค์ในการเก็บรวบรวมและใช้ข้อมูลที่มีความอ่อนไหว\n - เช่นเดียวกับข้างต้น\n\nข. รายการข้อมูลที่มีความอ่อนไหวที่เก็บรวบรวม\n - ข้อมูลที่เกี่ยวข้องกับสุขภาพ (ประวัติการเจ็บป่วยส่วนบุคคล ประวัติโรคในครอบครัว ประวัติการฉีดวัคซีน สถานะสุขภาพกายและจิต พฤติกรรมสุขภาพ ฯลฯ)\n\nค. ระยะเวลาเก็บรักษา: '+retentionDate+' (ทำลายทันทีหลังสิ้นสุดระยะเวลาเก็บรักษา)\n\nง. สิทธิในการปฏิเสธความยินยอมในการเก็บรวบรวมข้อมูลที่มีความอ่อนไหว\n - ท่านสามารถปฏิเสธความยินยอมในการเก็บรวบรวมและใช้ข้อมูลที่มีความอ่อนไหวได้ แม้จะปฏิเสธ นักเรียนยังสามารถใช้ชีวิตในโรงเรียนได้ แต่การไม่ยินยอมอาจส่งผลให้นักเรียนไม่ได้รับการคุ้มครองและการดูแลสุขภาพที่เหมาะสม';
  _s2.descTranslations.tl='A. Layunin ng pangongolekta at paggamit ng sensitibong impormasyon\n - Kapareho ng nasa itaas\n\nB. Mga item ng sensitibong impormasyong kinokolekta\n - Impormasyon na nauugnay sa kalusugan (personal na kasaysayan ng sakit, kasaysayan ng sakit sa pamilya, kasaysayan ng pagbabakuna, pisikal at mental na kalagayan ng kalusugan, mga gawi sa kalusugan, atbp.)\n\nC. Panahon ng pagpapanatili: '+retentionDate+' (sinisira kaagad pagkatapos ng panahon ng pagpapanatili)\n\nD. Karapatan na tanggihan ang pahintulot sa pangongolekta ng sensitibong impormasyon\n - Maaari kayong tumanggi na pumayag sa pangongolekta at paggamit ng sensitibong impormasyon. Kahit tumanggi, maaari pa ring magpatuloy ang mag-aaral sa buhay-paaralan; gayunpaman, ang hindi pagpayag ay maaaring makahadlang sa mag-aaral na makatanggap ng naaangkop na proteksyon at tugon sa kalusugan.';
  _s2.descTranslations.zh='一、敏感信息收集与使用目的\n - 与上述相同\n\n二、收集的敏感信息项目\n - 与健康相关的信息（个人病史、家族病史、预防接种史、身体和心理健康状况、健康生活习惯等）\n\n三、保留期限：'+retentionDate+'（保留期限届满后立即销毁）\n\n四、拒绝同意收集敏感信息的权利\n - 您可以拒绝同意收集和使用敏感信息。即使拒绝同意，学生仍可继续在校学习生活，但因未同意可能导致学生在健康保护和应对方面受到影响。';
  _s2.descTranslations.ja='イ. 機微情報の収集・利用目的\n - 上記と同じ\n\nロ. 収集する機微情報の項目\n - 健康等に関する情報（個人の病歴、家族歴、予防接種歴、身体的・精神的健康状態、健康生活習慣等）\n\nハ. 保有期間：'+retentionDate+'（保有期間終了後、速やかに破棄）\n\nニ. 機微情報収集同意拒否の権利\n - お客様は機微情報の収集・利用に同意しないことができます。同意を拒否された場合でも学生は学校生活を送ることができますが、不同意により健康上の適切な保護と対応を受ける際に支障が生じる場合があります。';
  _s2.descTranslations.mn='А. Эмзэг мэдээлэл цуглуулах, ашиглах зорилго\n - Дээрхтэй адил\n\nБ. Цуглуулах эмзэг мэдээллийн зүйл\n - Эрүүл мэндтэй холбоотой мэдээлэл (хувийн өвчний түүх, гэр бүлийн өвчний түүх, вакцинжуулалтын түүх, бие бялдар болон сэтгэцийн эрүүл мэндийн байдал, эрүүл мэндийн зуршил гэх мэт)\n\nВ. Хадгалах хугацаа: '+retentionDate+' (хугацаа дуусмагц нэн даруй устгана)\n\nГ. Эмзэг мэдээлэл цуглуулахыг зөвшөөрөхөөс татгалзах эрх\n - Та эмзэг мэдээлэл цуглуулах, ашиглахыг зөвшөөрөхөөс татгалзаж болно. Татгалзсан ч сурагч сургуулийн амьдралаа үргэлжлүүлж болох боловч зөвшөөрөхгүй байсан тохиолдолд эрүүл мэндийн зохих хамгаалалт, арга хэмжээ авахад саад учирч болно.';
  _s2.descTranslations.ne='क. संवेदनशील जानकारी सङ्कलन र प्रयोगको उद्देश्य\n - माथि उल्लेखित जस्तै\n\nख. सङ्कलन गरिने संवेदनशील जानकारीका विषयहरू\n - स्वास्थ्यसँग सम्बन्धित जानकारी (व्यक्तिगत रोग इतिहास, पारिवारिक रोग इतिहास, खोप इतिहास, शारीरिक र मानसिक स्वास्थ्य अवस्था, स्वास्थ्य बानी आदि)\n\nग. भण्डारण अवधि: '+retentionDate+' (भण्डारण अवधि समाप्त भएपछि तुरुन्तै नष्ट गरिन्छ)\n\nघ. संवेदनशील जानकारी सङ्कलनमा सहमति अस्वीकार गर्ने अधिकार\n - तपाईं संवेदनशील जानकारी सङ्कलन र प्रयोगमा सहमति अस्वीकार गर्न सक्नुहुन्छ। अस्वीकार गरे पनि विद्यार्थीले विद्यालयको जीवन जारी राख्न सक्छन्; तर सहमति नदिँदा विद्यार्थीले उचित स्वास्थ्य सुरक्षा र प्रतिक्रिया प्राप्त गर्न बाधा हुन सक्छ।';
  _s2.descTranslations.id='A. Tujuan pengumpulan dan penggunaan informasi sensitif\n - Sama seperti di atas\n\nB. Item informasi sensitif yang dikumpulkan\n - Informasi terkait kesehatan (riwayat penyakit pribadi, riwayat penyakit keluarga, riwayat vaksinasi, kondisi kesehatan fisik dan mental, kebiasaan kesehatan, dll.)\n\nC. Periode penyimpanan: '+retentionDate+' (segera dihancurkan setelah periode penyimpanan berakhir)\n\nD. Hak untuk menolak persetujuan pengumpulan informasi sensitif\n - Anda dapat menolak untuk menyetujui pengumpulan dan penggunaan informasi sensitif. Meskipun menolak, siswa tetap dapat melanjutkan kehidupan sekolah; namun, penolakan dapat menghambat siswa dalam menerima perlindungan dan respons kesehatan yang tepat.';
  _s2.descTranslations.ar='أ. أغراض جمع واستخدام المعلومات الحساسة\n - نفس ما ورد أعلاه\n\nب. بنود المعلومات الحساسة المجمعة\n - المعلومات المتعلقة بالصحة (التاريخ المرضي الشخصي، التاريخ المرضي العائلي، سجل التطعيمات، الحالة الصحية الجسدية والنفسية، العادات الصحية، إلخ)\n\nج. مدة الاحتفاظ: '+retentionDate+' (يتم إتلافها فوراً بعد انتهاء مدة الاحتفاظ)\n\nد. الحق في رفض الموافقة على جمع المعلومات الحساسة\n - يمكنكم رفض الموافقة على جمع واستخدام المعلومات الحساسة. حتى في حالة الرفض، يمكن للطالب مواصلة الحياة المدرسية؛ ومع ذلك، قد يعيق عدم الموافقة حصول الطالب على الحماية والاستجابة الصحية المناسبة.';
  _s2.descTranslations.ur='الف۔ حساس معلومات جمع اور استعمال کا مقصد\n - اوپر بیان کیے گئے جیسا ہی\n\nب۔ جمع کی جانے والی حساس معلومات\n - صحت سے متعلق معلومات (ذاتی طبی تاریخ، خاندانی طبی تاریخ، ویکسینیشن کی تاریخ، جسمانی اور ذہنی صحت کی حالت، صحت کی عادات وغیرہ)\n\nج۔ ذخیرہ کی مدت: '+retentionDate+' (ذخیرہ کی مدت ختم ہونے کے بعد فوری طور پر تلف کیا جائے گا)\n\nد۔ حساس معلومات جمع کرنے کی رضامندی سے انکار کا حق\n - آپ حساس معلومات کی جمع اور استعمال کی رضامندی سے انکار کر سکتے ہیں۔ انکار کی صورت میں بھی طالب علم اسکول کی زندگی جاری رکھ سکتا ہے؛ تاہم، رضامندی نہ دینے سے طالب علم کو مناسب صحت تحفظ اور ردعمل حاصل کرنے میں رکاوٹ ہو سکتی ہے۔';
  _s2.descTranslations.es='A. Propósito de la recopilación y uso de información sensible\n - Igual que lo anterior\n\nB. Elementos de información sensible recopilados\n - Información relacionada con la salud (historial médico personal, historial médico familiar, historial de vacunación, estado de salud física y mental, hábitos de salud, etc.)\n\nC. Período de conservación: '+retentionDate+' (se destruye sin demora tras finalizar el período de conservación)\n\nD. Derecho a rechazar el consentimiento para la recopilación de información sensible\n - Usted puede rechazar el consentimiento para la recopilación y uso de información sensible. Incluso si lo rechaza, el estudiante puede continuar su vida escolar; sin embargo, la falta de consentimiento puede impedir que el estudiante reciba la protección y respuesta de salud adecuadas.';
  /* s3 desc (응급처치) */
  _s3.descTranslations.en='If an emergency occurs with your child at school and a hospital referral is needed, in principle we will contact the guardian and hand over the child, except in cases of <emergency symptoms or equivalent symptoms> where the situation is urgent or critical. However, in an emergency or if we are unable to reach you, we consent to transporting the child to a nearby hospital via 119 rescue services. As emergency treatment consent requires a handwritten signature, it will be collected separately.';
  _s3.descTranslations.ru='Если в школе произойдёт экстренная ситуация с вашим ребёнком и потребуется направление в больницу, в принципе мы свяжемся с опекуном и передадим ребёнка, за исключением случаев <экстренных симптомов или аналогичных симптомов>, когда ситуация является срочной или критической. Однако в экстренной ситуации или если мы не сможем с вами связаться, мы соглашаемся на транспортировку ребёнка в ближайшую больницу через службу спасения 119. Поскольку согласие на экстренную помощь требует собственноручной подписи, оно будет собрано отдельно.';
  _s3.descTranslations.vi='Nếu xảy ra tình huống khẩn cấp với con em quý vị tại trường và cần chuyển đến bệnh viện, theo nguyên tắc chúng tôi sẽ liên hệ phụ huynh và bàn giao học sinh, ngoại trừ trường hợp <triệu chứng khẩn cấp hoặc tương đương> khi tình huống cấp bách hoặc nguy kịch. Tuy nhiên, trong trường hợp khẩn cấp hoặc không thể liên lạc được, chúng tôi đồng ý vận chuyển học sinh đến bệnh viện gần nhất qua dịch vụ cứu hộ 119. Vì đồng ý sơ cứu khẩn cấp cần chữ ký tay, sẽ được thu thập riêng.';
  _s3.descTranslations.km='ប្រសិនបើមានស្ថានភាពសង្គ្រោះបន្ទាន់កើតឡើងចំពោះកូនរបស់អ្នកនៅសាលា ហើយចាំបាច់ត្រូវបញ្ជូនទៅមន្ទីរពេទ្យ តាមគោលការណ៍ យើងនឹងទាក់ទងអាណាព្យាបាល និងប្រគល់កុមារ លើកលែងតែក្នុងករណី <រោគសញ្ញាសង្គ្រោះបន្ទាន់ ឬរោគសញ្ញាស្រដៀងគ្នា> ដែលស្ថានភាពមានភាពបន្ទាន់ ឬគ្រោះថ្នាក់។ ទោះជាយ៉ាងណា ក្នុងស្ថានភាពសង្គ្រោះបន្ទាន់ ឬប្រសិនបើយើងមិនអាចទាក់ទងអ្នកបាន យើងយល់ព្រមក្នុងការដឹកជញ្ជូនកុមារទៅមន្ទីរពេទ្យជិតបំផុតតាមរយៈក្រុមសង្គ្រោះ 119។ ដោយសារការយល់ព្រមលើការសង្គ្រោះបន្ទាន់ត្រូវការហត្ថលេខាដោយដៃ វានឹងត្រូវប្រមូលដោយឡែក។';
  _s3.descTranslations.th='หากเกิดเหตุฉุกเฉินกับบุตรหลานของท่านที่โรงเรียนและจำเป็นต้องส่งต่อไปโรงพยาบาล ตามหลักการเราจะติดต่อผู้ปกครองและส่งมอบนักเรียน ยกเว้นในกรณี <อาการฉุกเฉินหรืออาการเทียบเท่า> ที่สถานการณ์เร่งด่วนหรือวิกฤต อย่างไรก็ตาม ในกรณีฉุกเฉินหรือหากไม่สามารถติดต่อท่านได้ เรายินยอมให้ขนส่งนักเรียนไปยังโรงพยาบาลใกล้เคียงผ่านหน่วยกู้ภัย 119 เนื่องจากการยินยอมปฐมพยาบาลฉุกเฉินต้องใช้ลายเซ็นด้วยลายมือ จึงจะจัดเก็บแยกต่างหาก';
  _s3.descTranslations.tl='Kung magkaroon ng emerhensya sa inyong anak sa paaralan at kailangan ng referral sa ospital, sa prinsipyo ay makikipag-ugnayan kami sa tagapangalaga at ibibigay ang bata, maliban sa mga kaso ng <mga sintomas ng emerhensya o katumbas na mga sintomas> kung saan ang sitwasyon ay urgent o kritikal. Gayunpaman, sa emerhensya o kung hindi namin kayo makontak, sumasang-ayon kami na dalhin ang bata sa pinakamalapit na ospital sa pamamagitan ng 119 rescue services. Dahil ang pahintulot sa emergency treatment ay nangangailangan ng sulat-kamay na lagda, kokolektahin ito nang hiwalay.';
  _s3.descTranslations.zh='如果您的孩子在学校发生紧急情况，需要送往医院时，原则上我们会联系监护人并移交学生，但在出现<紧急症状或类似症状>且情况危急时除外。但在紧急情况下或无法联系到您时，同意通过119急救队将学生送往附近医院。由于急救处置同意需要亲笔签名，将另行收集。';
  _s3.descTranslations.ja='学校内でお子様に緊急事態が発生し、病院への搬送が必要な場合、<緊急症状およびそれに準ずる症状>等で危急または危篤な場合を除き、原則として保護者に連絡して引き渡しいたします。ただし、緊急事態の場合や連絡が取れない場合は、119救助隊を通じて近隣の病院へ搬送することに同意いたします。応急処置同意については自筆署名が必要なため、別途収集いたします。';
  _s3.descTranslations.mn='Сургууль дахь таны хүүхэдтэй яаралтай тусламжийн нөхцөл байдал үүсч, эмнэлэгт шилжүүлэх шаардлагатай бол <яаралтай шинж тэмдэг эсвэл түүнтэй дүйцэхүйц шинж тэмдэг>-ийн аюулгүй эсвэл ноцтой тохиолдлоос бусад үед зарчмын хувьд асран хамгаалагчтай холбоо барьж, хүүхдийг шилжүүлнэ. Гэхдээ яаралтай нөхцөлд эсвэл тантай холбоо барих боломжгүй үед хүүхдийг 119 аврах ангиар ойролцоох эмнэлэгт зөөвөрлөхийг зөвшөөрнө. Яаралтай тусламжийн зөвшөөрөлд гарын үсэг шаардлагатай тул тусад нь цуглуулна.';
  _s3.descTranslations.ne='यदि विद्यालयमा तपाईंको बच्चासँग आपतकालीन स्थिति उत्पन्न भई अस्पताल पठाउनु परे, <आपतकालीन लक्षण वा समकक्ष लक्षण> जस्ता अत्यावश्यक वा गम्भीर अवस्थाबाहेक सिद्धान्ततः अभिभावकलाई सम्पर्क गरी बच्चा हस्तान्तरण गरिन्छ। तर आपतकालीन अवस्थामा वा सम्पर्क गर्न नसकिएमा 119 उद्धार सेवाद्वारा नजिकको अस्पतालमा लैजान सहमति दिइन्छ। आपतकालीन उपचार सहमतिमा हस्तलिखित हस्ताक्षर आवश्यक भएकोले छुट्टै सङ्कलन गरिनेछ।';
  _s3.descTranslations.id='Jika terjadi keadaan darurat pada anak Anda di sekolah dan perlu dirujuk ke rumah sakit, pada prinsipnya kami akan menghubungi wali dan menyerahkan anak, kecuali dalam kasus <gejala darurat atau gejala setara> di mana situasinya mendesak atau kritis. Namun, dalam keadaan darurat atau jika kami tidak dapat menghubungi Anda, kami menyetujui untuk mengangkut anak ke rumah sakit terdekat melalui layanan penyelamatan 119. Karena persetujuan perawatan darurat memerlukan tanda tangan tulisan tangan, maka akan dikumpulkan secara terpisah.';
  _s3.descTranslations.ar='إذا حدثت حالة طوارئ لطفلكم في المدرسة واحتاج الأمر إلى تحويله إلى المستشفى، فمن حيث المبدأ سنتواصل مع ولي الأمر ونسلم الطفل، باستثناء حالات <الأعراض الطارئة أو الأعراض المماثلة> التي يكون فيها الوضع عاجلاً أو حرجاً. ومع ذلك، في حالة الطوارئ أو إذا لم نتمكن من الاتصال بكم، نوافق على نقل الطفل إلى أقرب مستشفى عبر خدمات الإنقاذ 119. نظراً لأن الموافقة على العلاج الطارئ تتطلب توقيعاً بخط اليد، سيتم جمعها بشكل منفصل.';
  _s3.descTranslations.ur='اگر اسکول میں آپ کے بچے کو ہنگامی صورتحال پیش آئے اور ہسپتال بھیجنا ضروری ہو تو، <ہنگامی علامات یا مساوی علامات> کی فوری یا نازک صورتحال کے علاوہ، اصولی طور پر سرپرست سے رابطہ کیا جائے گا اور بچے کو حوالے کیا جائے گا۔ تاہم، ہنگامی صورتحال میں یا آپ سے رابطہ نہ ہو سکنے کی صورت میں، 119 ریسکیو سروسز کے ذریعے قریب ترین ہسپتال میں منتقلی کی رضامندی دی جاتی ہے۔ چونکہ ہنگامی علاج کی رضامندی کے لیے ہاتھ سے دستخط ضروری ہیں، اسے الگ سے جمع کیا جائے گا۔';
  _s3.descTranslations.es='Si ocurre una emergencia con su hijo/a en la escuela y se necesita derivación hospitalaria, en principio contactaremos al tutor y entregaremos al menor, excepto en casos de <síntomas de emergencia o síntomas equivalentes> donde la situación sea urgente o crítica. Sin embargo, en caso de emergencia o si no podemos contactarle, consentimos transportar al menor al hospital más cercano mediante los servicios de rescate 119. Como el consentimiento de tratamiento de emergencia requiere firma manuscrita, se recogerá por separado.';
  /* s1 질문 번역 */
  _s1.questions[0].translations.en={text:'Do you consent to the collection and use of personal information as described above?',options:['I consent','I do not consent']};
  _s1.questions[0].translations.ru={text:'Согласны ли вы на сбор и использование персональных данных, как описано выше?',options:['Согласен(на)','Не согласен(на)']};
  _s1.questions[0].translations.vi={text:'Quý vị có đồng ý thu thập và sử dụng thông tin cá nhân như mô tả ở trên không?',options:['Đồng ý','Không đồng ý']};
  _s1.questions[0].translations.km={text:'តើអ្នកយល់ព្រមក្នុងការប្រមូល និងប្រើប្រាស់ព័ត៌មានផ្ទាល់ខ្លួនដូចបានពិពណ៌នាខាងលើដែរឬទេ?',options:['យល់ព្រម','មិនយល់ព្រម']};
  _s1.questions[0].translations.th={text:'ท่านยินยอมให้เก็บรวบรวมและใช้ข้อมูลส่วนบุคคลตามที่อธิบายไว้ข้างต้นหรือไม่?',options:['ยินยอม','ไม่ยินยอม']};
  _s1.questions[0].translations.tl={text:'Pumapayag ba kayo sa pangongolekta at paggamit ng personal na impormasyon tulad ng inilarawan sa itaas?',options:['Pumapayag','Hindi pumapayag']};
  _s1.questions[0].translations.zh={text:'您是否同意如上所述收集和使用个人信息？',options:['同意','不同意']};
  _s1.questions[0].translations.ja={text:'上記のとおり個人情報を収集・利用することに同意されますか？',options:['同意する','同意しない']};
  _s1.questions[0].translations.mn={text:'Дээрх байдлаар хувийн мэдээллийг цуглуулж, ашиглахыг зөвшөөрч байна уу?',options:['Зөвшөөрнө','Зөвшөөрөхгүй']};
  _s1.questions[0].translations.ne={text:'माथि वर्णन गरिए अनुसार व्यक्तिगत जानकारी सङ्कलन र प्रयोगमा सहमति दिनुहुन्छ?',options:['सहमत छु','सहमत छैन']};
  _s1.questions[0].translations.id={text:'Apakah Anda menyetujui pengumpulan dan penggunaan informasi pribadi sebagaimana dijelaskan di atas?',options:['Setuju','Tidak setuju']};
  _s1.questions[0].translations.ar={text:'هل توافقون على جمع واستخدام المعلومات الشخصية كما هو موضح أعلاه؟',options:['أوافق','لا أوافق']};
  _s1.questions[0].translations.ur={text:'کیا آپ اوپر بیان کیے گئے مطابق ذاتی معلومات کی جمع اور استعمال سے متفق ہیں؟',options:['متفق ہوں','متفق نہیں ہوں']};
  _s1.questions[0].translations.es={text:'¿Consiente la recopilación y uso de información personal como se describe arriba?',options:['Consiento','No consiento']};
  /* s2 질문 번역 */
  _s2.questions[0].translations.en={text:'Do you consent to the collection and use of sensitive information as described above?',options:['I consent','I do not consent']};
  _s2.questions[0].translations.ru={text:'Согласны ли вы на сбор и использование конфиденциальной информации, как описано выше?',options:['Согласен(на)','Не согласен(на)']};
  _s2.questions[0].translations.vi={text:'Quý vị có đồng ý thu thập và sử dụng thông tin nhạy cảm như mô tả ở trên không?',options:['Đồng ý','Không đồng ý']};
  _s2.questions[0].translations.km={text:'តើអ្នកយល់ព្រមក្នុងការប្រមូល និងប្រើប្រាស់ព័ត៌មានរសើបដូចបានពិពណ៌នាខាងលើដែរឬទេ?',options:['យល់ព្រម','មិនយល់ព្រម']};
  _s2.questions[0].translations.th={text:'ท่านยินยอมให้เก็บรวบรวมและใช้ข้อมูลที่มีความอ่อนไหวตามที่อธิบายไว้ข้างต้นหรือไม่?',options:['ยินยอม','ไม่ยินยอม']};
  _s2.questions[0].translations.tl={text:'Pumapayag ba kayo sa pangongolekta at paggamit ng sensitibong impormasyon tulad ng inilarawan sa itaas?',options:['Pumapayag','Hindi pumapayag']};
  _s2.questions[0].translations.zh={text:'您是否同意如上所述收集和使用敏感信息？',options:['同意','不同意']};
  _s2.questions[0].translations.ja={text:'上記のとおり機微情報を収集・利用することに同意されますか？',options:['同意する','同意しない']};
  _s2.questions[0].translations.mn={text:'Дээрх байдлаар эмзэг мэдээллийг цуглуулж, ашиглахыг зөвшөөрч байна уу?',options:['Зөвшөөрнө','Зөвшөөрөхгүй']};
  _s2.questions[0].translations.ne={text:'माथि वर्णन गरिए अनुसार संवेदनशील जानकारी सङ्कलन र प्रयोगमा सहमति दिनुहुन्छ?',options:['सहमत छु','सहमत छैन']};
  _s2.questions[0].translations.id={text:'Apakah Anda menyetujui pengumpulan dan penggunaan informasi sensitif sebagaimana dijelaskan di atas?',options:['Setuju','Tidak setuju']};
  _s2.questions[0].translations.ar={text:'هل توافقون على جمع واستخدام المعلومات الحساسة كما هو موضح أعلاه؟',options:['أوافق','لا أوافق']};
  _s2.questions[0].translations.ur={text:'کیا آپ اوپر بیان کیے گئے مطابق حساس معلومات کی جمع اور استعمال سے متفق ہیں؟',options:['متفق ہوں','متفق نہیں ہوں']};
  _s2.questions[0].translations.es={text:'¿Consiente la recopilación y uso de información sensible como se describe arriba?',options:['Consiento','No consiento']};
  /* s3 질문 번역 */
  _s3.questions[0].translations.en={text:'Do you consent to the above?',options:['Yes','No']};
  _s3.questions[0].translations.ru={text:'Согласны ли вы с вышеизложенным?',options:['Да','Нет']};
  _s3.questions[0].translations.vi={text:'Quý vị có đồng ý với nội dung trên không?',options:['Có','Không']};
  _s3.questions[0].translations.km={text:'តើអ្នកយល់ព្រមនឹងខ្លឹមសារខាងលើដែរឬទេ?',options:['បាទ/ចាស','ទេ']};
  _s3.questions[0].translations.th={text:'ท่านยินยอมตามเนื้อหาข้างต้นหรือไม่?',options:['ใช่','ไม่ใช่']};
  _s3.questions[0].translations.tl={text:'Pumapayag ba kayo sa nilalaman sa itaas?',options:['Oo','Hindi']};
  _s3.questions[0].translations.zh={text:'您是否同意以上内容？',options:['是','否']};
  _s3.questions[0].translations.ja={text:'上記の内容に同意されますか？',options:['はい','いいえ']};
  _s3.questions[0].translations.mn={text:'Дээрх агуулгыг зөвшөөрч байна уу?',options:['Тийм','Үгүй']};
  _s3.questions[0].translations.ne={text:'माथिको विषयवस्तुमा सहमति दिनुहुन्छ?',options:['छ','छैन']};
  _s3.questions[0].translations.id={text:'Apakah Anda menyetujui isi di atas?',options:['Ya','Tidak']};
  _s3.questions[0].translations.ar={text:'هل توافقون على المحتوى أعلاه؟',options:['نعم','لا']};
  _s3.questions[0].translations.ur={text:'کیا آپ اوپر بیان کردہ مضامین سے متفق ہیں؟',options:['ہاں','نہیں']};
  _s3.questions[0].translations.es={text:'¿Está de acuerdo con el contenido anterior?',options:['Sí','No']};

  /* ── s3b: 미세먼지/오존 (sections[3]) ── */
  const _s3b=svSurveyData.sections[3];
  if(!_s3b.titleTranslations) _s3b.titleTranslations={};
  if(!_s3b.descTranslations) _s3b.descTranslations={};
  _s3b.questions.forEach(function(q){if(!q.translations)q.translations={};if(!q.descTranslations)q.descTranslations={};});
  _s3b.titleTranslations.en='Fine Dust / Ozone';_s3b.titleTranslations.ru='Мелкодисперсная пыль / Озон';_s3b.titleTranslations.vi='Bụi mịn / Ô-zôn';_s3b.titleTranslations.km='ធូលីល្អិត / អូហ្សូន';_s3b.titleTranslations.th='ฝุ่นละเอียด / โอโซน';_s3b.titleTranslations.tl='Fine Dust / Ozone';_s3b.titleTranslations.zh='细颗粒物 / 臭氧';_s3b.titleTranslations.ja='微小粒子状物質 / オゾン';_s3b.titleTranslations.mn='Нарийн тоос / Озон';
  _s3b.titleTranslations.ne='सूक्ष्म धूलो / ओजोन';_s3b.titleTranslations.id='Debu Halus / Ozon';_s3b.titleTranslations.ar='الغبار الدقيق / الأوزون';_s3b.titleTranslations.ur='باریک دھول / اوزون';_s3b.titleTranslations.es='Polvo Fino / Ozono';
  _s3b.descTranslations.en='▪ If your child has an underlying condition related to fine dust or ozone (asthma, allergies, atopic dermatitis, respiratory disease, cardiovascular disease, etc.), parents are requested to submit a doctor\'s diagnosis or medical opinion (medical certificate, treatment confirmation, etc.) to the school health office.\n※ The name of the underlying condition related to fine dust or ozone, a doctor\'s opinion, or a future treatment plan must be specified.\n\n▪ If the above medical opinion or diagnosis has been submitted in advance, and the fine dust or ozone concentration in your area is rated \'Bad\' or higher, an illness-related absence (not counted as attendance) can be recognized simply by a parent\'s advance notice (phone call or text message to the homeroom teacher) made 30 minutes before class begins on that day.\n※ If the student was absent due to the illness before submitting the documents, and you wish to have it recognized as an illness-related absence, the absence report and diagnosis must be submitted within 5 days from the date of absence (the name of the underlying condition must be included).\n※ The number of attendance days required for a student to complete each grade level must be at least two-thirds of the total class days for that grade.';
  _s3b.descTranslations.ru='▪ Если у учащегося имеется основное заболевание, связанное с мелкодисперсной пылью или озоном (астма, аллергия, атопический дерматит, заболевания дыхательных путей, сердечно-сосудистые заболевания и т.д.), родителям необходимо предоставить в школьный медицинский кабинет справку от врача или медицинское заключение.\n※ В документе должно быть обязательно указано название основного заболевания, мнение врача или план дальнейшего лечения.\n\n▪ Если медицинское заключение или справка были представлены заранее, а концентрация мелкодисперсной пыли или озона достигает уровня «Плохое» или выше, пропуск по болезни может быть признан на основании только предварительного уведомления родителя за 30 минут до начала занятий.\n※ Если учащийся отсутствовал до подачи документов, заявление об отсутствии и справку необходимо подать в течение 5 дней.\n※ Количество дней посещения должно составлять не менее двух третей от общего количества учебных дней.';
  _s3b.descTranslations.vi='▪ Nếu học sinh có bệnh nền liên quan đến bụi mịn hoặc ô-zôn (hen suyễn, dị ứng, viêm da cơ địa, bệnh hô hấp, bệnh tim mạch, v.v.), phụ huynh vui lòng nộp giấy chẩn đoán hoặc ý kiến của bác sĩ cho phòng y tế trường học.\n※ Bắt buộc phải ghi rõ tên bệnh nền, ý kiến bác sĩ hoặc kế hoạch điều trị.\n\n▪ Nếu giấy tờ đã được nộp trước, và nồng độ bụi mịn hoặc ô-zôn đạt mức \'Xấu\' trở lên, việc nghỉ học do bệnh sẽ được chấp nhận chỉ với thông báo trước của phụ huynh trước giờ học 30 phút.\n※ Nếu học sinh đã nghỉ trước khi nộp giấy tờ, phải nộp đơn trong vòng 5 ngày.\n※ Số ngày đi học phải đạt ít nhất hai phần ba tổng số ngày học.';
  _s3b.descTranslations.km='▪ ប្រសិនបើសិស្សមានជំងឺមូលដ្ឋានទាក់ទងនឹងធូលីល្អិត ឬអូហ្សូន សូមអាណាព្យាបាលផ្ញើវិញ្ញាបនបត្រវេជ្ជសាស្ត្រទៅបន្ទប់សុខភាពសាលា។\n※ ត្រូវតែបញ្ជាក់ឈ្មោះជំងឺមូលដ្ឋាន មតិវេជ្ជបណ្ឌិត ឬផែនការព្យាបាលអនាគត។\n\n▪ ប្រសិនបើឯកសារត្រូវបានដាក់ជាមុន ហើយកម្រិតធូលីល្អិតមានកម្រិត \'អាក្រក់\' ឬខ្ពស់ជាងនេះ ការអវត្តមានដោយសារជំងឺអាចត្រូវបានទទួលស្គាល់។\n※ ប្រសិនបើអវត្តមានមុនពេលដាក់ឯកសារ សូមដាក់ពាក្យក្នុងរយៈពេល ៥ ថ្ងៃ។\n※ ចំនួនថ្ងៃចូលរៀនត្រូវតែមានយ៉ាងហោចណាស់ពីរភាគបីនៃចំនួនថ្ងៃសិក្សាសរុប។';
  _s3b.descTranslations.th='▪ หากนักเรียนมีโรคประจำตัวที่เกี่ยวข้องกับฝุ่นละเอียดหรือโอโซน ขอให้ผู้ปกครองส่งใบรับรองแพทย์ให้ห้องพยาบาลโรงเรียน\n※ ต้องระบุชื่อโรคประจำตัว ความเห็นของแพทย์ หรือแผนการรักษา\n\n▪ หากได้ส่งเอกสารล่วงหน้าแล้ว และฝุ่นละเอียดอยู่ในระดับ \'แย่\' ขึ้นไป การขาดเรียนเนื่องจากเจ็บป่วยจะได้รับการยอมรับเพียงแค่ผู้ปกครองแจ้งล่วงหน้า 30 นาที\n※ หากขาดเรียนก่อนยื่นเอกสาร ต้องยื่นภายใน 5 วัน\n※ จำนวนวันเข้าเรียนต้องไม่น้อยกว่าสองในสามของจำนวนวันเรียนทั้งหมด';
  _s3b.descTranslations.tl='▪ Kung ang estudyante ay may karamdaman na nauugnay sa fine dust o ozone, hinihiling sa mga magulang na magsumite ng diagnosis ng doktor sa school health office.\n※ Kinakailangang tukuyin ang pangalan ng karamdaman, opinyon ng doktor, o plano ng paggamot.\n\n▪ Kung naisumite na nang maaga ang dokumento, at ang fine dust ay nasa antas na \'Masama\' o mas mataas, ang pagliban dahil sa sakit ay maaaring kilalanin sa pamamagitan lamang ng advance na abiso ng magulang 30 minuto bago ang klase.\n※ Kung lumiban bago isumite ang mga dokumento, dapat isumite sa loob ng 5 araw.\n※ Ang bilang ng araw ng pagpasok ay dapat hindi bababa sa dalawang-katlo ng kabuuang bilang ng araw ng klase.';
  _s3b.descTranslations.zh='▪ 如果学生患有与细颗粒物或臭氧相关的基础疾病，请家长将医生的诊断书提交至学校保健室。\n※ 必须注明基础疾病名称、医生意见或治疗方案。\n\n▪ 如果已提前提交文件，且细颗粒物浓度达到"差"级以上，当天只需家长提前30分钟通知即可认定为因病缺勤。\n※ 如在提交文件之前已缺勤，须在5天内提交。\n※ 出勤天数须达到总上课天数的三分之二以上。';
  _s3b.descTranslations.ja='▪ 微小粒子状物質またはオゾンに関連する基礎疾患がある場合、保護者は医師の診断書を保健室に提出してください。\n※ 基礎疾患名、医師の所見または今後の治療意見の明記が必須です。\n\n▪ 事前に提出している場合、微小粒子状物質濃度が「悪い」以上の場合、授業開始30分前の保護者の事前連絡のみで疾病欠席が認められます。\n※ 事前提出前に欠席した場合は5日以内に提出が必要です。\n※ 出席日数は授業日数の3分の2以上でなければなりません。';
  _s3b.descTranslations.mn='▪ Хэрэв сурагч нарийн тоос эсвэл озонтой холбоотой суурь өвчтэй (багтраа, харшил, атопик арьсны үрэвсэл, амьсгалын замын өвчин, зүрх судасны өвчин гэх мэт) бол эцэг эхээс эмчийн оношлогоо эсвэл дүгнэлтийг сургуулийн эрүүл мэндийн өрөөнд ирүүлнэ үү.\n※ Суурь өвчний нэр, эмчийн санал эсвэл цаашдын эмчилгээний төлөвлөгөөг заавал тодорхой бичнэ.\n\n▪ Хэрэв дээрх баримт бичгийг урьдчилан ирүүлсэн бөгөөд тухайн бүс нутгийн нарийн тоосны агууламж \'Муу\' эсвэл түүнээс дээш үнэлэгдвэл зөвхөн эцэг эхийн урьдчилсан мэдэгдлээр (тухайн өдрийн хичээл эхлэхээс 30 минутын өмнө ангийн багшид утасдах эсвэл мессеж илгээх) өвчний шалтгаант таслалтыг хүлээн зөвшөөрнө.\n※ Баримт бичиг ирүүлэхээс өмнө сурагч хичээл тасалсан бол тасалсан өдрөөс 5 хоногийн дотор тасалсны тайлбар болон оношлогоог ирүүлнэ.\n※ Тухайн ангийг дүүргэхэд шаардлагатай ирцийн өдрийн тоо нийт хичээлийн өдрийн гуравны хоёроос доошгүй байна.';
  _s3b.descTranslations.ne='▪ यदि विद्यार्थीलाई सूक्ष्म धूलो वा ओजोनसँग सम्बन्धित आधारभूत रोग छ (दम, एलर्जी, एटोपिक छाला रोग, श्वासप्रश्वास रोग, हृदय रोग आदि) भने अभिभावकले चिकित्सकको निदान वा चिकित्सा प्रमाणपत्र विद्यालय स्वास्थ्य कक्षमा बुझाउनुपर्छ।\n※ आधारभूत रोगको नाम, चिकित्सकको राय वा भविष्यको उपचार योजना अनिवार्य रूपमा उल्लेख गर्नुपर्छ।\n\n▪ यदि माथिको चिकित्सा प्रमाणपत्र पहिले नै बुझाइसकिएको छ र सूक्ष्म धूलो वा ओजोनको मात्रा \'खराब\' वा सोभन्दा माथि छ भने, कक्षा सुरु हुनुभन्दा 30 मिनेट अगाडि अभिभावकको पूर्व सूचना (फोन वा सन्देश) मात्रले रोग सम्बन्धी अनुपस्थिति मान्यता पाउँछ।\n※ कागजात बुझाउनुअघि अनुपस्थित भएमा 5 दिनभित्र प्रतिवेदन र निदान बुझाउनुपर्छ।\n※ उपस्थिति दिनको संख्या कुल कक्षा दिनको कम्तीमा दुई-तिहाइ हुनुपर्छ।';
  _s3b.descTranslations.id='▪ Jika siswa memiliki penyakit dasar yang berkaitan dengan debu halus atau ozon (asma, alergi, dermatitis atopik, penyakit pernapasan, penyakit kardiovaskular, dll.), orang tua diminta menyerahkan diagnosis dokter atau surat keterangan medis ke ruang kesehatan sekolah.\n※ Nama penyakit dasar, pendapat dokter, atau rencana pengobatan harus dicantumkan.\n\n▪ Jika dokumen telah diserahkan sebelumnya dan konsentrasi debu halus atau ozon berada pada level \'Buruk\' atau lebih tinggi, ketidakhadiran karena sakit dapat diakui hanya dengan pemberitahuan awal dari orang tua 30 menit sebelum kelas dimulai.\n※ Jika siswa tidak hadir sebelum menyerahkan dokumen, laporan harus diserahkan dalam 5 hari.\n※ Jumlah hari kehadiran harus minimal dua pertiga dari total hari sekolah.';
  _s3b.descTranslations.ar='▪ إذا كان الطالب يعاني من مرض مزمن مرتبط بالغبار الدقيق أو الأوزون (ربو، حساسية، التهاب جلدي تأتبي، أمراض الجهاز التنفسي، أمراض القلب والأوعية الدموية، إلخ)، يُطلب من أولياء الأمور تقديم تقرير طبي إلى غرفة الصحة المدرسية.\n※ يجب تحديد اسم المرض المزمن ورأي الطبيب أو خطة العلاج المستقبلية.\n\n▪ إذا تم تقديم التقرير الطبي مسبقاً وكان تركيز الغبار الدقيق أو الأوزون بمستوى \'سيئ\' أو أعلى، يمكن اعتبار الغياب بسبب المرض بمجرد إخطار ولي الأمر المسبق قبل 30 دقيقة من بدء الحصة.\n※ إذا تغيب الطالب قبل تقديم المستندات، يجب تقديمها خلال 5 أيام.\n※ يجب ألا تقل أيام الحضور عن ثلثي إجمالي أيام الدراسة.';
  _s3b.descTranslations.ur='▪ اگر طالب علم کو باریک دھول یا اوزون سے متعلق بنیادی بیماری ہے (دمہ، الرجی، ایٹوپک جلد کی سوزش، سانس کی بیماریاں، دل کی بیماریاں وغیرہ) تو والدین سے درخواست ہے کہ ڈاکٹر کی تشخیص یا طبی رائے اسکول ہیلتھ آفس میں جمع کرائیں۔\n※ بنیادی بیماری کا نام، ڈاکٹر کی رائے یا مستقبل کا علاج کا منصوبہ بیان کرنا لازمی ہے۔\n\n▪ اگر مذکورہ دستاویزات پہلے جمع کرا دیے گئے ہیں اور باریک دھول یا اوزون کی سطح \'خراب\' یا اس سے زیادہ ہو، تو کلاس شروع ہونے سے 30 منٹ پہلے والدین کی پیشگی اطلاع سے بیماری کی وجہ سے غیر حاضری تسلیم کی جا سکتی ہے۔\n※ اگر دستاویزات جمع کرانے سے پہلے غیر حاضر ہوئے ہوں تو 5 دنوں کے اندر رپورٹ جمع کرانی ہوگی۔\n※ حاضری کے دنوں کی تعداد کل تدریسی دنوں کے کم از کم دو تہائی ہونی چاہیے۔';
  _s3b.descTranslations.es='▪ Si el estudiante tiene una enfermedad de base relacionada con el polvo fino o el ozono (asma, alergias, dermatitis atópica, enfermedades respiratorias, enfermedades cardiovasculares, etc.), se solicita a los padres que presenten un diagnóstico médico o certificado médico en la enfermería escolar.\n※ Se debe especificar el nombre de la enfermedad de base, la opinión del médico o el plan de tratamiento futuro.\n\n▪ Si el documento médico ha sido presentado previamente y la concentración de polvo fino u ozono alcanza el nivel \'Malo\' o superior, la ausencia por enfermedad puede reconocerse simplemente con un aviso previo del padre/madre 30 minutos antes del inicio de clases.\n※ Si el estudiante se ausentó antes de presentar los documentos, deben presentarse dentro de los 5 días siguientes.\n※ El número de días de asistencia debe ser al menos dos tercios del total de días lectivos.';
  _s3b.questions[0].translations.en={text:'Has the student ever been diagnosed with an underlying condition related to fine dust or ozone?',options:['Yes','No']};
  _s3b.questions[0].translations.ru={text:'Был ли у учащегося диагностирован заболевание, связанное с мелкодисперсной пылью или озоном?',options:['Да','Нет']};
  _s3b.questions[0].translations.vi={text:'Học sinh đã từng được chẩn đoán mắc bệnh nền liên quan đến bụi mịn hoặc ô-zôn chưa?',options:['Có','Không']};
  _s3b.questions[0].translations.km={text:'តើសិស្សធ្លាប់ត្រូវបានធ្វើរោគវិនិច្ឆ័យថាមានជំងឺមូលដ្ឋានទាក់ទងនឹងធូលីល្អិត ឬអូហ្សូនដែរឬទេ?',options:['បាទ/ចាស','ទេ']};
  _s3b.questions[0].translations.th={text:'นักเรียนเคยได้รับการวินิจฉัยว่าเป็นโรคประจำตัวที่เกี่ยวข้องกับฝุ่นละเอียดหรือโอโซนหรือไม่?',options:['ใช่','ไม่ใช่']};
  _s3b.questions[0].translations.tl={text:'Ang estudyante ba ay na-diagnose na may karamdaman na nauugnay sa fine dust o ozone?',options:['Oo','Hindi']};
  _s3b.questions[0].translations.zh={text:'学生是否曾被诊断患有与细颗粒物或臭氧相关的基础疾病？',options:['是','否']};
  _s3b.questions[0].translations.ja={text:'微小粒子状物質やオゾンに関連する基礎疾患と診断されたことがありますか？',options:['はい','いいえ']};
  _s3b.questions[0].translations.mn={text:'Сурагч нарийн тоос, озонтой холбоотой суурь өвчнөөр оношлогдож байсан уу?',options:['Тийм','Үгүй']};
  _s3b.questions[0].translations.ne={text:'के विद्यार्थीलाई सूक्ष्म धूलो वा ओजोनसँग सम्बन्धित आधारभूत रोग भएको निदान गरिएको छ?',options:['छ','छैन']};
  _s3b.questions[0].translations.id={text:'Apakah siswa pernah didiagnosis memiliki penyakit dasar yang berkaitan dengan debu halus atau ozon?',options:['Ya','Tidak']};
  _s3b.questions[0].translations.ar={text:'هل تم تشخيص الطالب بمرض مزمن مرتبط بالغبار الدقيق أو الأوزون؟',options:['نعم','لا']};
  _s3b.questions[0].translations.ur={text:'کیا طالب علم کو باریک دھول یا اوزون سے متعلق بنیادی بیماری کی تشخیص ہوئی ہے؟',options:['ہاں','نہیں']};
  _s3b.questions[0].translations.es={text:'¿Se le ha diagnosticado al estudiante alguna enfermedad de base relacionada con el polvo fino o el ozono?',options:['Sí','No']};

  /* ── s3c: 당뇨 학생 파악 (sections[4]) ── */
  const _s3c=svSurveyData.sections[4];
  if(!_s3c.titleTranslations) _s3c.titleTranslations={};
  if(!_s3c.descTranslations) _s3c.descTranslations={};
  _s3c.questions.forEach(function(q){if(!q.translations)q.translations={};if(!q.descTranslations)q.descTranslations={};});
  _s3c.titleTranslations.en='Identifying Students with Diabetes';_s3c.titleTranslations.ru='Выявление учащихся с диабетом';_s3c.titleTranslations.vi='Xác định học sinh mắc bệnh tiểu đường';_s3c.titleTranslations.km='ការកំណត់សិស្សដែលមានជំងឺទឹកនោមផ្អែម';_s3c.titleTranslations.th='การสำรวจนักเรียนที่เป็นเบาหวาน';_s3c.titleTranslations.tl='Pagtukoy sa mga Estudyanteng may Diabetes';_s3c.titleTranslations.zh='糖尿病学生调查';_s3c.titleTranslations.ja='糖尿病の児童・生徒の把握';_s3c.titleTranslations.mn='Чихрийн шижинтэй сурагчдыг тодорхойлох';
  _s3c.titleTranslations.ne='मधुमेह भएका विद्यार्थीहरूको पहिचान';_s3c.titleTranslations.id='Identifikasi Siswa dengan Diabetes';_s3c.titleTranslations.ar='تحديد الطلاب المصابين بالسكري';_s3c.titleTranslations.ur='ذیابیطس والے طلباء کی شناخت';_s3c.titleTranslations.es='Identificación de Estudiantes con Diabetes';
  _s3c.descTranslations.en='If not applicable, please select \'No\'. Additional counseling will be conducted for students who have been diagnosed. We are identifying students with diabetes in accordance with the social demand for protection of students with juvenile diabetes, the detailed implementation plan for juvenile diabetes student protection measures, and Article 15-2 of the School Health Act (emergency treatment, etc.).';
  _s3c.descTranslations.ru='Если не применимо, выберите «Нет». Дополнительные консультации будут проведены для учащихся с диагнозом. Мы выявляем учащихся с диабетом в соответствии с требованиями по защите учащихся с ювенильным диабетом и статьёй 15-2 Закона о школьном здравоохранении.';
  _s3c.descTranslations.vi='Nếu không liên quan, vui lòng chọn \'Không\'. Việc tư vấn bổ sung sẽ được thực hiện cho các học sinh đã được chẩn đoán. Chúng tôi đang xác định học sinh mắc bệnh tiểu đường theo Điều 15-2 Luật Sức khỏe Học đường.';
  _s3c.descTranslations.km='ប្រសិនបើមិនពាក់ព័ន្ធ សូមជ្រើសរើស \'ទេ\'។ ការប្រឹក្សាបន្ថែមនឹងត្រូវធ្វើឡើងសម្រាប់សិស្សដែលបានធ្វើរោគវិនិច្ឆ័យ។';
  _s3c.descTranslations.th='หากไม่เกี่ยวข้อง กรุณาเลือก \'ไม่ใช่\' จะมีการให้คำปรึกษาเพิ่มเติมสำหรับนักเรียนที่ได้รับการวินิจฉัยแล้ว';
  _s3c.descTranslations.tl='Kung hindi naaangkop, mangyaring piliin ang \'Hindi\'. Magkakaroon ng karagdagang konsultasyon para sa mga estudyanteng na-diagnose.';
  _s3c.descTranslations.zh='如果不适用，请选择"否"。将对已确诊的学生进行进一步咨询。我们根据《学校保健法》第15条之2对糖尿病学生进行调查。';
  _s3c.descTranslations.ja='該当しない場合は「いいえ」を選択してください。診断を受けた児童・生徒については追加カウンセリングを実施します。学校保健法第15条の2に基づき糖尿病の児童・生徒を把握しています。';
  _s3c.descTranslations.mn='Хамааралгүй бол "Үгүй" гэж сонгоно уу. Оношлогдсон сурагчдад нэмэлт зөвлөгөө өгнө. Сургуулийн эрүүл мэндийн тухай хуулийн 15-2 дугаар зүйлийн дагуу чихрийн шижинтэй сурагчдыг тодорхойлж байна.';
  _s3c.descTranslations.ne='लागू नभएमा कृपया \'छैन\' छान्नुहोस्। निदान भएका विद्यार्थीहरूका लागि थप परामर्श प्रदान गरिनेछ। विद्यालय स्वास्थ्य ऐनको धारा 15-2 अनुसार मधुमेह भएका विद्यार्थीहरूको पहिचान गरिँदैछ।';
  _s3c.descTranslations.id='Jika tidak berlaku, silakan pilih \'Tidak\'. Konseling tambahan akan dilakukan untuk siswa yang telah didiagnosis. Kami mengidentifikasi siswa dengan diabetes sesuai Pasal 15-2 Undang-Undang Kesehatan Sekolah.';
  _s3c.descTranslations.ar='إذا لم ينطبق الأمر، يرجى اختيار \'لا\'. سيتم إجراء إرشاد إضافي للطلاب الذين تم تشخيصهم. نقوم بتحديد الطلاب المصابين بالسكري وفقاً للمادة 15-2 من قانون الصحة المدرسية.';
  _s3c.descTranslations.ur='اگر لاگو نہیں ہوتا تو براہ کرم \'نہیں\' منتخب کریں۔ تشخیص شدہ طلباء کے لیے اضافی مشاورت کی جائے گی۔ اسکول صحت قانون کی دفعہ 15-2 کے مطابق ذیابیطس والے طلباء کی شناخت کی جا رہی ہے۔';
  _s3c.descTranslations.es='Si no aplica, seleccione \'No\'. Se realizará asesoramiento adicional para los estudiantes diagnosticados. Identificamos a los estudiantes con diabetes de acuerdo con el Artículo 15-2 de la Ley de Salud Escolar.';
  _s3c.questions[0].translations.en={text:'Has the student been diagnosed with diabetes?',options:['No','Type 1 Diabetes','Type 2 Diabetes']};
  _s3c.questions[0].translations.ru={text:'Был ли у учащегося диагностирован диабет?',options:['Нет','Диабет 1-го типа','Диабет 2-го типа']};
  _s3c.questions[0].translations.vi={text:'Học sinh đã được chẩn đoán mắc bệnh tiểu đường chưa?',options:['Không','Tiểu đường tuýp 1','Tiểu đường tuýp 2']};
  _s3c.questions[0].translations.km={text:'តើសិស្សត្រូវបានធ្វើរោគវិនិច្ឆ័យថាមានជំងឺទឹកនោមផ្អែមឬទេ?',options:['ទេ','ប្រភេទទី១','ប្រភេទទី២']};
  _s3c.questions[0].translations.th={text:'นักเรียนได้รับการวินิจฉัยว่าเป็นเบาหวานหรือไม่?',options:['ไม่ใช่','เบาหวานชนิดที่ 1','เบาหวานชนิดที่ 2']};
  _s3c.questions[0].translations.tl={text:'Ang estudyante ba ay na-diagnose na may diabetes?',options:['Hindi','Type 1 Diabetes','Type 2 Diabetes']};
  _s3c.questions[0].translations.zh={text:'学生是否被诊断患有糖尿病？',options:['否','1型糖尿病','2型糖尿病']};
  _s3c.questions[0].translations.ja={text:'糖尿病と診断されましたか？',options:['いいえ','1型糖尿病','2型糖尿病']};
  _s3c.questions[0].translations.mn={text:'Сурагч чихрийн шижингээр оношлогдсон уу?',options:['Үгүй','1-р хэлбэрийн чихрийн шижин','2-р хэлбэрийн чихрийн шижин']};
  _s3c.questions[0].translations.ne={text:'के विद्यार्थीलाई मधुमेहको निदान गरिएको छ?',options:['छैन','टाइप 1 मधुमेह','टाइप 2 मधुमेह']};
  _s3c.questions[0].translations.id={text:'Apakah siswa telah didiagnosis menderita diabetes?',options:['Tidak','Diabetes Tipe 1','Diabetes Tipe 2']};
  _s3c.questions[0].translations.ar={text:'هل تم تشخيص الطالب بمرض السكري؟',options:['لا','سكري النوع الأول','سكري النوع الثاني']};
  _s3c.questions[0].translations.ur={text:'کیا طالب علم کو ذیابیطس کی تشخیص ہوئی ہے؟',options:['نہیں','ٹائپ 1 ذیابیطس','ٹائپ 2 ذیابیطس']};
  _s3c.questions[0].translations.es={text:'¿Se le ha diagnosticado diabetes al estudiante?',options:['No','Diabetes Tipo 1','Diabetes Tipo 2']};

  /* ── s4: 병력-1 (sections[5]) ── */
  const _s4=svSurveyData.sections[5];
  if(!_s4.titleTranslations) _s4.titleTranslations={};
  if(!_s4.descTranslations) _s4.descTranslations={};
  _s4.questions.forEach(function(q){if(!q.translations)q.translations={};if(!q.descTranslations)q.descTranslations={};});
  _s4.titleTranslations.en='Medical History - 1';_s4.titleTranslations.ru='История болезни - 1';_s4.titleTranslations.vi='Tiền sử bệnh - 1';_s4.titleTranslations.km='ប្រវត្តិជំងឺ - ១';_s4.titleTranslations.th='ประวัติการเจ็บป่วย - 1';_s4.titleTranslations.tl='Kasaysayang Medikal - 1';_s4.titleTranslations.zh='病史 - 1';_s4.titleTranslations.ja='病歴 - 1';_s4.titleTranslations.mn='Өвчний түүх - 1';
  _s4.titleTranslations.ne='चिकित्सा इतिहास - 1';_s4.titleTranslations.id='Riwayat Medis - 1';_s4.titleTranslations.ar='التاريخ الطبي - 1';_s4.titleTranslations.ur='طبی تاریخ - 1';_s4.titleTranslations.es='Historial Médico - 1';
  _s4.questions[0].translations.en={text:'If any member of the household has been treated for or diagnosed with a condition, please write the relationship to the student and the name of the condition.'};
  _s4.questions[0].translations.ru={text:'Если кто-либо из членов семьи проходил лечение или получил диагноз заболевания, укажите степень родства с учащимся и название заболевания.'};
  _s4.questions[0].translations.vi={text:'Nếu có thành viên trong gia đình đã từng điều trị hoặc được chẩn đoán mắc bệnh, vui lòng ghi mối quan hệ với học sinh và tên bệnh.'};
  _s4.questions[0].translations.km={text:'ប្រសិនបើសមាជិកណាម្នាក់នៃគ្រួសារធ្លាប់បានព្យាបាល ឬធ្វើរោគវិនិច្ឆ័យជំងឺ សូមសរសេរទំនាក់ទំនងជាមួយសិស្ស និងឈ្មោះជំងឺ។'};
  _s4.questions[0].translations.th={text:'หากสมาชิกในครอบครัวเคยได้รับการรักษาหรือวินิจฉัยว่าเป็นโรค กรุณาระบุความสัมพันธ์กับนักเรียนและชื่อโรค'};
  _s4.questions[0].translations.tl={text:'Kung ang sinumang miyembro ng pamilya ay nagpagamot o na-diagnose na may sakit, mangyaring isulat ang relasyon sa estudyante at ang pangalan ng sakit.'};
  _s4.questions[0].translations.zh={text:'如果同住家庭成员中有人曾接受治疗或被诊断患有疾病，请写明与学生的关系及疾病名称。'};
  _s4.questions[0].translations.ja={text:'同居する家族の中で疾患の治療を受けた方や診断を受けた方がいる場合、続柄と疾患名を記入してください。'};
  _s4.questions[0].translations.mn={text:'Хамт амьдардаг гэр бүлийн гишүүдийн дунд өвчнөөр эмчлүүлсэн эсвэл оношлогдсон хүн байвал сурагчтай ямар хамааралтай болон өвчний нэрийг бичнэ үү.'};
  _s4.questions[0].translations.ne={text:'परिवारका कुनै सदस्यलाई रोगको उपचार वा निदान गरिएको छ भने विद्यार्थीसँगको सम्बन्ध र रोगको नाम लेख्नुहोस्।'};
  _s4.questions[0].translations.id={text:'Jika ada anggota keluarga yang pernah dirawat atau didiagnosis dengan suatu penyakit, tuliskan hubungannya dengan siswa dan nama penyakitnya.'};
  _s4.questions[0].translations.ar={text:'إذا كان أي فرد من أفراد الأسرة قد تلقى علاجاً أو تم تشخيصه بمرض، يرجى كتابة صلة القرابة بالطالب واسم المرض.'};
  _s4.questions[0].translations.ur={text:'اگر خاندان کے کسی فرد کا کسی بیماری کا علاج ہوا ہو یا تشخیص ہوئی ہو، تو براہ کرم طالب علم سے رشتہ اور بیماری کا نام لکھیں۔'};
  _s4.questions[0].translations.es={text:'Si algún miembro de la familia ha recibido tratamiento o ha sido diagnosticado con alguna enfermedad, escriba la relación con el estudiante y el nombre de la enfermedad.'};
  _s4.questions[0].descTranslations.en='Example> Sister: Type 1 Diabetes / Grandmother: Alzheimer\'s\nThis is an optional question.';
  _s4.questions[0].descTranslations.ru='Пример> Сестра: диабет 1-го типа / Бабушка: Альцгеймер\nНеобязательный вопрос.';
  _s4.questions[0].descTranslations.vi='Ví dụ> Chị gái: Tiểu đường tuýp 1 / Bà ngoại: Alzheimer\nĐây là câu hỏi không bắt buộc.';
  _s4.questions[0].descTranslations.km='ឧទាហរណ៍> បងស្រី៖ ទឹកនោមផ្អែមប្រភេទទី១ / យាយ៖ អាល់ស្ហៃមើ\nនេះជាសំណួរជាជម្រើស។';
  _s4.questions[0].descTranslations.th='ตัวอย่าง> พี่สาว: เบาหวานชนิดที่ 1 / คุณยาย: อัลไซเมอร์\nไม่บังคับตอบ';
  _s4.questions[0].descTranslations.tl='Halimbawa> Ate: Type 1 Diabetes / Lola: Alzheimer\'s\nOpsyonal na tanong ito.';
  _s4.questions[0].descTranslations.zh='示例> 姐姐：1型糖尿病 / 奶奶：阿尔茨海默病\n此为选答题。';
  _s4.questions[0].descTranslations.ja='例> 姉：1型糖尿病 / 祖母：アルツハイマー\n任意回答の質問です。';
  _s4.questions[0].descTranslations.mn='Жишээ> Эгч: 1-р хэлбэрийн чихрийн шижин / Эмээ: Альцгеймер\nСонголтот асуулт.';
  _s4.questions[0].descTranslations.ne='उदाहरण> दिदी: टाइप 1 मधुमेह / हजुरआमा: अल्जाइमर\nयो वैकल्पिक प्रश्न हो।';
  _s4.questions[0].descTranslations.id='Contoh> Kakak perempuan: Diabetes Tipe 1 / Nenek: Alzheimer\nIni pertanyaan opsional.';
  _s4.questions[0].descTranslations.ar='مثال> الأخت: سكري النوع الأول / الجدة: ألزهايمر\nهذا سؤال اختياري.';
  _s4.questions[0].descTranslations.ur='مثال> بہن: ٹائپ 1 ذیابیطس / دادی: الزائمر\nیہ اختیاری سوال ہے۔';
  _s4.questions[0].descTranslations.es='Ejemplo> Hermana: Diabetes Tipo 1 / Abuela: Alzheimer\nEsta es una pregunta opcional.';
  _s4.questions[1].translations.en={text:'If the student has any congenital health abnormalities, please describe the details and when the diagnosis was made.'};
  _s4.questions[1].translations.ru={text:'Если у учащегося имеются врождённые нарушения здоровья, опишите подробности и время постановки диагноза.'};
  _s4.questions[1].translations.vi={text:'Nếu học sinh có bất thường sức khỏe bẩm sinh, vui lòng mô tả chi tiết và thời điểm chẩn đoán.'};
  _s4.questions[1].translations.km={text:'ប្រសិនបើសិស្សមានបញ្ហាសុខភាពពីកំណើត សូមពិពណ៌នាលម្អិត និងពេលវេលាធ្វើរោគវិនិច្ឆ័យ។'};
  _s4.questions[1].translations.th={text:'หากนักเรียนมีความผิดปกติทางสุขภาพแต่กำเนิด กรุณาระบุรายละเอียดและช่วงเวลาที่วินิจฉัย'};
  _s4.questions[1].translations.tl={text:'Kung ang estudyante ay may congenital na abnormalidad sa kalusugan, mangyaring ilarawan ang mga detalye at kung kailan ito na-diagnose.'};
  _s4.questions[1].translations.zh={text:'如果学生有先天性健康异常，请描述具体内容及诊断时间。'};
  _s4.questions[1].translations.ja={text:'先天的な健康上の異常がある場合、その内容と診断時期を記入してください。'};
  _s4.questions[1].translations.mn={text:'Сурагчид төрөлхийн эрүүл мэндийн гажиг байгаа бол түүний агуулга болон оношлогдсон цагийг бичнэ үү.'};
  _s4.questions[1].translations.ne={text:'यदि विद्यार्थीलाई जन्मजात स्वास्थ्य असामान्यता छ भने विवरण र निदान समय लेख्नुहोस्।'};
  _s4.questions[1].translations.id={text:'Jika siswa memiliki kelainan kesehatan bawaan, jelaskan detailnya dan kapan didiagnosis.'};
  _s4.questions[1].translations.ar={text:'إذا كان لدى الطالب أي تشوهات صحية خلقية، يرجى وصف التفاصيل وتاريخ التشخيص.'};
  _s4.questions[1].translations.ur={text:'اگر طالب علم میں کوئی پیدائشی صحت کی خرابی ہے تو تفصیلات اور تشخیص کا وقت لکھیں۔'};
  _s4.questions[1].translations.es={text:'Si el estudiante tiene alguna anomalía de salud congénita, describa los detalles y cuándo se diagnosticó.'};
  _s4.questions[1].descTranslations.en='Example> Diagnosed with ventricular septal defect after birth, and had surgery in the same year.\nThis is an optional question.';_s4.questions[1].descTranslations.ru='Пример> После рождения диагностирован дефект межжелудочковой перегородки, в том же году проведена операция.\nНеобязательный вопрос.';_s4.questions[1].descTranslations.vi='Ví dụ> Được chẩn đoán thông liên thất sau sinh, và phẫu thuật cùng năm.\nKhông bắt buộc.';_s4.questions[1].descTranslations.km='ឧទាហរណ៍> បានធ្វើរោគវិនិច្ឆ័យថាមានរន្ធក្នុងជញ្ជាំងបេះដូងបន្ទាប់ពីកើត។\nជាជម្រើស។';_s4.questions[1].descTranslations.th='ตัวอย่าง> วินิจฉัยว่าเป็นโรครูรั่วผนังกั้นหัวใจหลังคลอด ได้รับการผ่าตัดในปีเดียวกัน\nไม่บังคับตอบ';_s4.questions[1].descTranslations.tl='Halimbawa> Na-diagnose na may ventricular septal defect pagkatapos ipanganak.\nOpsyonal.';_s4.questions[1].descTranslations.zh='示例> 出生后被诊断为室间隔缺损，同年接受手术。\n选答题。';_s4.questions[1].descTranslations.ja='例> 出生後に心室中隔欠損と診断され同年に手術。\n任意回答です。';_s4.questions[1].descTranslations.mn='Жишээ> Төрсний дараа ховдлын хоорондын хана цоорхойтой гэж оношлогдож, тухайн жилдээ мэс засал хийсэн.\nСонголтот.';
  _s4.questions[1].descTranslations.ne='उदाहरण> जन्मपछि भेन्ट्रिकुलर सेप्टल दोष निदान, उही वर्ष शल्यक्रिया।\nवैकल्पिक प्रश्न।';_s4.questions[1].descTranslations.id='Contoh> Didiagnosis defek septum ventrikel setelah lahir, dioperasi tahun yang sama.\nOpsional.';_s4.questions[1].descTranslations.ar='مثال> تم تشخيص ثقب في الحاجز البطيني بعد الولادة، وأجريت عملية جراحية في نفس العام.\nسؤال اختياري.';_s4.questions[1].descTranslations.ur='مثال> پیدائش کے بعد وینٹریکولر سیپٹل ڈیفیکٹ کی تشخیص، اسی سال سرجری ہوئی۔\nاختیاری۔';_s4.questions[1].descTranslations.es='Ejemplo> Diagnosticado con defecto del tabique ventricular al nacer, operado el mismo año.\nPregunta opcional.';
  _s4.questions[2].translations.en={text:'If the student has had any surgery or hospitalization due to an accident or acquired condition, please describe the details and timing.'};
  _s4.questions[2].translations.ru={text:'Если учащийся перенёс операцию или госпитализацию вследствие несчастного случая или приобретённого заболевания, опишите подробности.'};
  _s4.questions[2].translations.vi={text:'Nếu học sinh từng phẫu thuật hoặc nhập viện do tai nạn hoặc vấn đề sức khỏe, vui lòng mô tả chi tiết.'};
  _s4.questions[2].translations.km={text:'ប្រសិនបើសិស្សធ្លាប់វះកាត់ ឬសម្រាកពេទ្យដោយសារគ្រោះថ្នាក់ សូមពិពណ៌នាលម្អិត។'};
  _s4.questions[2].translations.th={text:'หากนักเรียนเคยผ่าตัดหรือเข้ารักษาตัวในโรงพยาบาลเนื่องจากอุบัติเหตุ กรุณาระบุรายละเอียด'};
  _s4.questions[2].translations.tl={text:'Kung ang estudyante ay nakaranas ng operasyon o nag-confine dahil sa aksidente, mangyaring ilarawan ang mga detalye.'};
  _s4.questions[2].translations.zh={text:'如果学生过去曾因事故或后天问题接受手术或住院治疗，请描述具体内容。'};
  _s4.questions[2].translations.ja={text:'過去に事故や後天的な問題で手術・入院した場合、その内容と時期を記入してください。'};
  _s4.questions[2].translations.mn={text:'Өмнө нь сурагч осол эсвэл олдмол шалтгаанаар мэс засал хийлгэсэн, эмнэлэгт хэвтсэн бол дэлгэрэнгүй болон цаг хугацааг бичнэ үү.'};
  _s4.questions[2].translations.ne={text:'यदि विद्यार्थीले दुर्घटना वा अन्य कारणले शल्यक्रिया वा अस्पतालमा भर्ना भएको छ भने विवरण र समय लेख्नुहोस्।'};
  _s4.questions[2].translations.id={text:'Jika siswa pernah menjalani operasi atau rawat inap karena kecelakaan atau kondisi yang didapat, jelaskan detailnya.'};
  _s4.questions[2].translations.ar={text:'إذا خضع الطالب لعملية جراحية أو دخل المستشفى بسبب حادث أو حالة مكتسبة، يرجى وصف التفاصيل والتوقيت.'};
  _s4.questions[2].translations.ur={text:'اگر طالب علم نے حادثے یا مکتسب وجہ سے سرجری یا ہسپتال میں داخلہ کروایا ہو تو تفصیلات اور وقت لکھیں۔'};
  _s4.questions[2].translations.es={text:'Si el estudiante ha tenido alguna cirugía u hospitalización por accidente o condición adquirida, describa los detalles y el momento.'};
  _s4.questions[2].descTranslations.en='Example> Hit by a motorcycle near school, wrist fracture, surgery at OO Hospital.\nOptional question.';_s4.questions[2].descTranslations.ru='Пример> Сбит мотоциклом возле школы, перелом запястья, операция в больнице OO.\nНеобязательный вопрос.';_s4.questions[2].descTranslations.vi='Ví dụ> Bị xe máy đâm gần trường, gãy cổ tay, phẫu thuật tại bệnh viện OO.\nKhông bắt buộc.';_s4.questions[2].descTranslations.km='ឧទាហរណ៍> ត្រូវម៉ូតូបុកនៅជិតសាលា ឆ្អឹងកដៃបាក់ វះកាត់នៅមន្ទីរពេទ្យ OO។\nជាជម្រើស។';_s4.questions[2].descTranslations.th='ตัวอย่าง> ถูกมอเตอร์ไซค์ชนใกล้โรงเรียน กระดูกข้อมือหัก ผ่าตัดที่โรงพยาบาล OO\nไม่บังคับตอบ';_s4.questions[2].descTranslations.tl='Halimbawa> Nabangga ng motorsiklo, nabali ang pulso, na-operahan sa OO Hospital.\nOpsyonal.';_s4.questions[2].descTranslations.zh='示例> 在学校附近被摩托车撞倒，手腕骨折，在OO医院手术。\n选答题。';_s4.questions[2].descTranslations.ja='例> 学校付近でバイクにはねられ手首骨折、OO病院で手術。\n任意回答です。';_s4.questions[2].descTranslations.mn='Жишээ> Сургуулийн ойролцоо мотоциклоор дайруулж, бугуйны яс хугарч, OO эмнэлэгт мэс засал хийлгэсэн.\nСонголтот.';
  _s4.questions[2].descTranslations.ne='उदाहरण> विद्यालय नजिक मोटरसाइकलले ठक्कर दियो, नाडीको हड्डी भाँचियो, OO अस्पतालमा शल्यक्रिया।\nवैकल्पिक।';_s4.questions[2].descTranslations.id='Contoh> Tertabrak motor dekat sekolah, patah pergelangan tangan, operasi di RS OO.\nOpsional.';_s4.questions[2].descTranslations.ar='مثال> صدمته دراجة نارية بالقرب من المدرسة، كسر في المعصم، عملية جراحية في مستشفى OO.\nسؤال اختياري.';_s4.questions[2].descTranslations.ur='مثال> اسکول کے قریب موٹرسائیکل سے ٹکرایا، کلائی ٹوٹ گئی، OO ہسپتال میں سرجری۔\nاختیاری۔';_s4.questions[2].descTranslations.es='Ejemplo> Atropellado por una moto cerca de la escuela, fractura de muñeca, cirugía en el hospital OO.\nPregunta opcional.';
  _s4.questions[3].translations.en={text:'If the student received any infectious disease vaccinations in the past year, please select all that apply.',options:['Japanese Encephalitis','Influenza','Flu','COVID-19','Don\'t know']};
  _s4.questions[3].translations.ru={text:'Если учащийся получал прививки за последний год, выберите все подходящие.',options:['Японский энцефалит','Грипп','Грипп','COVID-19','Не знаю']};
  _s4.questions[3].translations.vi={text:'Nếu học sinh đã tiêm vắc-xin trong năm qua, vui lòng chọn tất cả phù hợp.',options:['Viêm não Nhật Bản','Cúm','Cúm','COVID-19','Không biết']};
  _s4.questions[3].translations.km={text:'ប្រសិនបើសិស្សបានចាក់វ៉ាក់សាំងក្នុងរយៈពេល ១ ឆ្នាំកន្លងមក សូមជ្រើសរើសទាំងអស់។',options:['រោគរលាកខួរក្បាលជប៉ុន','គ្រុនផ្តាសាយ','គ្រុនផ្តាសាយ','កូវីដ-១៩','មិនដឹង']};
  _s4.questions[3].translations.th={text:'หากนักเรียนได้รับวัคซีนในช่วง 1 ปีที่ผ่านมา กรุณาเลือกทั้งหมดที่ตรงกัน',options:['ไข้สมองอักเสบญี่ปุ่น','ไข้หวัดใหญ่','ไข้หวัดใหญ่','โควิด-19','ไม่ทราบ']};
  _s4.questions[3].translations.tl={text:'Kung nakatanggap ng bakuna sa nakaraang taon, piliin ang lahat ng naaangkop.',options:['Japanese Encephalitis','Influenza','Trangkaso','COVID-19','Hindi alam']};
  _s4.questions[3].translations.zh={text:'如果学生在过去一年内接种过疫苗，请选择所有适用选项。',options:['日本脑炎','流感','流感','新冠病毒','不知道']};
  _s4.questions[3].translations.ja={text:'この1年間に予防接種を受けた場合、該当するものをすべて選択してください。',options:['日本脳炎','インフルエンザ','インフルエンザ','新型コロナ','わからない']};
  _s4.questions[3].translations.mn={text:'Сүүлийн 1 жилд халдварт өвчнөөс урьдчилан сэргийлэх вакцин хийлгэсэн бол бүгдийг сонгоно уу.',options:['Япон тархины үрэвсэл','Томуу','Томуу','КОВИД-19','Мэдэхгүй']};
  _s4.questions[3].translations.ne={text:'यदि विद्यार्थीले गत 1 वर्षमा संक्रामक रोग विरुद्ध खोप लगाएको छ भने सबै छान्नुहोस्।',options:['जापानी इन्सेफलाइटिस','इन्फ्लुएन्जा','फ्लु','कोभिड-19','थाहा छैन']};
  _s4.questions[3].translations.id={text:'Jika siswa menerima vaksinasi dalam setahun terakhir, pilih semua yang sesuai.',options:['Ensefalitis Jepang','Influenza','Flu','COVID-19','Tidak tahu']};
  _s4.questions[3].translations.ar={text:'إذا تلقى الطالب أي تطعيمات ضد الأمراض المعدية خلال العام الماضي، يرجى تحديد جميع ما ينطبق.',options:['التهاب الدماغ الياباني','الإنفلونزا','الإنفلونزا','كوفيد-19','لا أعرف']};
  _s4.questions[3].translations.ur={text:'اگر طالب علم نے گزشتہ 1 سال میں متعدی بیماریوں کے خلاف ویکسین لگوائی ہو تو سب منتخب کریں۔',options:['جاپانی دماغی سوزش','انفلوئنزا','فلو','کووڈ-19','معلوم نہیں']};
  _s4.questions[3].translations.es={text:'Si el estudiante recibió alguna vacuna contra enfermedades infecciosas en el último año, seleccione todas las que apliquen.',options:['Encefalitis japonesa','Influenza','Gripe','COVID-19','No sé']};
  _s4.questions[3].descTranslations.en='Optional question. Multiple selections allowed.';_s4.questions[3].descTranslations.ru='Необязательный вопрос. Можно выбрать несколько.';_s4.questions[3].descTranslations.vi='Không bắt buộc. Có thể chọn nhiều.';_s4.questions[3].descTranslations.km='ជាជម្រើស។ អាចជ្រើសរើសច្រើន។';_s4.questions[3].descTranslations.th='ไม่บังคับตอบ เลือกได้หลายข้อ';_s4.questions[3].descTranslations.tl='Opsyonal. Maaaring pumili ng marami.';_s4.questions[3].descTranslations.zh='选答题。可多选。';_s4.questions[3].descTranslations.ja='任意回答。複数選択可。';_s4.questions[3].descTranslations.mn='Сонголтот. Олон сонголт хийж болно.';
  _s4.questions[3].descTranslations.ne='वैकल्पिक प्रश्न। बहु छनौट गर्न सकिन्छ।';_s4.questions[3].descTranslations.id='Opsional. Boleh pilih lebih dari satu.';_s4.questions[3].descTranslations.ar='سؤال اختياري. يمكن اختيار أكثر من إجابة.';_s4.questions[3].descTranslations.ur='اختیاری۔ ایک سے زیادہ انتخاب کر سکتے ہیں۔';_s4.questions[3].descTranslations.es='Pregunta opcional. Se permite selección múltiple.';
  _s4.questions[4].translations.en={text:'If the student has had any illness or received medical treatment in the past year, please indicate.',gridRows:['Allergic dermatitis','Atopic dermatitis','Asthma','Tuberculosis','Seizures (incl. convulsions)','Cancer','Diabetes (Type 1 & 2)','Dental conditions','Emotional difficulties (depression, stress)','Schizophrenia','Epilepsy','(Female) Menstrual cramps'],gridCols:['Not applicable','Cured','Under treatment'],options:[]};
  _s4.questions[4].translations.ru={text:'Если учащийся за последний год болел или проходил лечение, отметьте статус.',gridRows:['Аллергический дерматит','Атопический дерматит','Астма','Туберкулёз','Судороги','Рак','Диабет (1 и 2 типа)','Стоматологические заболевания','Эмоциональные трудности','Шизофрения','Эпилепсия','(Девочки) Менструальные боли'],gridCols:['Не относится','Вылечено','На лечении'],options:[]};
  _s4.questions[4].translations.vi={text:'Nếu học sinh đã mắc bệnh hoặc đi khám trong năm qua, vui lòng đánh dấu.',gridRows:['Viêm da dị ứng','Viêm da cơ địa','Hen suyễn','Lao','Co giật','Ung thư','Tiểu đường (tuýp 1 & 2)','Bệnh răng miệng','Khó khăn cảm xúc','Tâm thần phân liệt','Động kinh','(Nữ) Đau bụng kinh'],gridCols:['Không liên quan','Đã khỏi','Đang điều trị'],options:[]};
  _s4.questions[4].translations.km={text:'ប្រសិនបើសិស្សធ្លាប់មានជំងឺក្នុងរយៈពេល ១ ឆ្នាំកន្លងមក សូមសម្គាល់។',gridRows:['រោគស្បែកអាឡែស៊ី','រោគស្បែកអាតូពី','ជំងឺហឺត','រោគរបេង','ការដាក់កន្រ្តាក់','មហារីក','ទឹកនោមផ្អែម','ជំងឺធ្មេញ','ការលំបាកផ្លូវអារម្មណ៍','ជំងឺចិត្តវិកលចរិត','ជំងឺរាគវាត','(សិស្សស្រី) ឈឺពេលមករដូវ'],gridCols:['មិនពាក់ព័ន្ធ','បានជា','កំពុងព្យាបាល'],options:[]};
  _s4.questions[4].translations.th={text:'หากนักเรียนเคยเจ็บป่วยหรือเข้ารับการรักษาในช่วง 1 ปีที่ผ่านมา กรุณาทำเครื่องหมาย',gridRows:['โรคผิวหนังภูมิแพ้','ผิวหนังอะโทปี','หอบหืด','วัณโรค','ชัก','มะเร็ง','เบาหวาน','โรคทันตกรรม','ความยากลำบากทางอารมณ์','จิตเภท','ลมชัก','(หญิง) ปวดประจำเดือน'],gridCols:['ไม่เกี่ยวข้อง','หายแล้ว','รักษาอยู่'],options:[]};
  _s4.questions[4].translations.tl={text:'Kung may sakit o nakatanggap ng paggamot sa nakaraang taon, mangyaring markahan.',gridRows:['Allergic dermatitis','Atopic dermatitis','Hika','Tuberculosis','Seizure','Kanser','Diabetes','Sakit sa ngipin','Emosyonal na kahirapan','Schizophrenia','Epilepsy','(Babae) Dysmenorrhea'],gridCols:['Hindi naaangkop','Gumaling','Ginagamot'],options:[]};
  _s4.questions[4].translations.zh={text:'如果学生在过去一年内患病或就诊，请标注状态。',gridRows:['过敏性皮炎','特应性皮炎','哮喘','结核','发作(惊厥)','癌症','糖尿病','牙科疾病','情绪困难','精神分裂症','癫痫','(女生)痛经'],gridCols:['不适用','已痊愈','治疗中'],options:[]};
  _s4.questions[4].translations.ja={text:'この1年間に病気や診療を受けた場合、該当する状態を選択してください。',gridRows:['アレルギー性皮膚炎','アトピー性皮膚炎','喘息','結核','発作(けいれん含む)','がん','糖尿病','歯科疾患','情緒的困難','統合失調症','てんかん','(女子)生理痛'],gridCols:['該当なし','完治','治療中'],options:[]};
  _s4.questions[4].translations.mn={text:'Сүүлийн 1 жилд сурагч өвчилсөн эсвэл эмнэлэгт үзүүлсэн бол тохирох төлөвийг сонгоно уу.',gridRows:['Харшлын арьсны үрэвсэл','Атопик арьсны үрэвсэл','Багтраа','Сүрьеэ','Таталт (зангилаа орно)','Хавдар','Чихрийн шижин (1 ба 2-р хэлбэр)','Шүдний өвчин','Сэтгэл санааны хүндрэл (сэтгэлийн хямрал, стресс)','Шизофрени','Унадаг өвчин','(Охид) Сарын тэмдгийн өвдөлт'],gridCols:['Хамааралгүй','Бүрэн эдгэрсэн','Эмчилгээ хийлгэж буй'],options:[]};
  _s4.questions[4].translations.ne={text:'यदि विद्यार्थी गत 1 वर्षमा बिरामी भएको वा उपचार गराएको छ भने अवस्था छान्नुहोस्।',gridRows:['एलर्जिक छाला रोग','एटोपिक छाला रोग','दम','क्षयरोग','दौरा (ऐंठन सहित)','क्यान्सर','मधुमेह (टाइप 1 र 2)','दन्त रोग','भावनात्मक कठिनाई (अवसाद, तनाव)','स्किजोफ्रेनिया','मिर्गी','(छात्रा) महिनावारी दुखाइ'],gridCols:['लागू हुँदैन','निको भइसक्यो','उपचारमा छ'],options:[]};
  _s4.questions[4].translations.id={text:'Jika siswa pernah sakit atau berobat dalam setahun terakhir, tandai statusnya.',gridRows:['Dermatitis alergi','Dermatitis atopik','Asma','Tuberkulosis','Kejang','Kanker','Diabetes (Tipe 1 & 2)','Penyakit gigi','Kesulitan emosional (depresi, stres)','Skizofrenia','Epilepsi','(Perempuan) Nyeri haid'],gridCols:['Tidak berlaku','Sembuh','Dalam pengobatan'],options:[]};
  _s4.questions[4].translations.ar={text:'إذا أصيب الطالب بأي مرض أو تلقى علاجاً طبياً خلال العام الماضي، يرجى تحديد الحالة.',gridRows:['التهاب جلدي تحسسي','التهاب جلدي تأتبي','ربو','سل','نوبات (بما في ذلك التشنجات)','سرطان','سكري (النوع 1 و 2)','أمراض الأسنان','صعوبات عاطفية (اكتئاب، إجهاد)','فصام','صرع','(إناث) آلام الدورة الشهرية'],gridCols:['لا ينطبق','شُفي','تحت العلاج'],options:[]};
  _s4.questions[4].translations.ur={text:'اگر طالب علم گزشتہ 1 سال میں بیمار ہوا ہو یا طبی علاج کروایا ہو تو حالت نشان لگائیں۔',gridRows:['الرجی والی جلد کی سوزش','ایٹوپک جلد کی سوزش','دمہ','تپ دق','دورے (اینٹھن سمیت)','کینسر','ذیابیطس (ٹائپ 1 اور 2)','دانتوں کی بیماریاں','جذباتی مشکلات (ڈپریشن، تناؤ)','شیزوفرینیا','مرگی','(لڑکیاں) ماہواری کا درد'],gridCols:['لاگو نہیں','ٹھیک ہو گیا','زیر علاج'],options:[]};
  _s4.questions[4].translations.es={text:'Si el estudiante ha tenido alguna enfermedad o ha recibido tratamiento médico en el último año, marque el estado.',gridRows:['Dermatitis alérgica','Dermatitis atópica','Asma','Tuberculosis','Convulsiones','Cáncer','Diabetes (Tipo 1 y 2)','Enfermedades dentales','Dificultades emocionales (depresión, estrés)','Esquizofrenia','Epilepsia','(Mujeres) Dolor menstrual'],gridCols:['No aplica','Curado','En tratamiento'],options:[]};
  _s4.questions[4].descTranslations.en='Optional. Select status for each condition.\n※ Menstrual cramps shown only to female students.';_s4.questions[4].descTranslations.ru='Необязательный. Выберите статус для каждого заболевания.\n※ Менструальные боли — только для девочек.';_s4.questions[4].descTranslations.vi='Không bắt buộc. Chọn trạng thái cho từng bệnh.\n※ Đau bụng kinh chỉ hiển thị cho nữ sinh.';_s4.questions[4].descTranslations.km='ជាជម្រើស។ សូមជ្រើសរើសស្ថានភាពសម្រាប់ជំងឺនីមួយៗ។\n※ ឈឺពេលមករដូវសម្រាប់សិស្សស្រីប៉ុណ្ណោះ។';_s4.questions[4].descTranslations.th='ไม่บังคับ เลือกสถานะแต่ละโรค\n※ ปวดประจำเดือนแสดงเฉพาะนักเรียนหญิง';_s4.questions[4].descTranslations.tl='Opsyonal. Piliin ang katayuan para sa bawat sakit.\n※ Dysmenorrhea para lamang sa babae.';_s4.questions[4].descTranslations.zh='选答。请为每种疾病选择状态。\n※ 痛经仅向女生显示。';_s4.questions[4].descTranslations.ja='任意回答。各疾病の状態を選択してください。\n※ 生理痛は女子生徒のみ表示。';_s4.questions[4].descTranslations.mn='Сонголтот. Өвчин тус бүрийн төлөвийг сонгоно уу.\n※ Сарын тэмдгийн өвдөлт зөвхөн охидод харагдана.';
  _s4.questions[4].descTranslations.ne='वैकल्पिक। प्रत्येक रोगको अवस्था छान्नुहोस्।\n※ महिनावारी दुखाइ छात्राहरूलाई मात्र देखिन्छ।';_s4.questions[4].descTranslations.id='Opsional. Pilih status untuk setiap penyakit.\n※ Nyeri haid hanya ditampilkan untuk siswi.';_s4.questions[4].descTranslations.ar='اختياري. حدد الحالة لكل مرض.\n※ آلام الدورة الشهرية تظهر للطالبات فقط.';_s4.questions[4].descTranslations.ur='اختیاری۔ ہر بیماری کی حالت منتخب کریں۔\n※ ماہواری کا درد صرف لڑکیوں کو دکھایا جاتا ہے۔';_s4.questions[4].descTranslations.es='Opcional. Seleccione el estado para cada enfermedad.\n※ El dolor menstrual solo se muestra a las estudiantes.';
  _s4.questions[5].translations.en={text:'If you checked one or more items in question 5, please describe the details.'};
  _s4.questions[5].translations.ru={text:'Если вы отметили пункты в вопросе 5, опишите подробности.'};
  _s4.questions[5].translations.vi={text:'Nếu đánh dấu một hoặc nhiều mục ở câu 5, vui lòng mô tả chi tiết.'};
  _s4.questions[5].translations.km={text:'ប្រសិនបើអ្នកបានធីកក្នុងសំណួរទី ៥ សូមពិពណ៌នាលម្អិត។'};
  _s4.questions[5].translations.th={text:'หากทำเครื่องหมายในข้อ 5 อย่างน้อยหนึ่งรายการ กรุณาเขียนรายละเอียด'};
  _s4.questions[5].translations.tl={text:'Kung nag-check ng isa o higit pang item sa tanong 5, mangyaring ilarawan ang mga detalye.'};
  _s4.questions[5].translations.zh={text:'如果在第5题中勾选了一项或多项，请详细描述。'};
  _s4.questions[5].translations.ja={text:'問5で1つ以上チェックした場合、詳しく記入してください。'};
  _s4.questions[5].translations.mn={text:'Дээрх 5-р асуултад нэг буюу түүнээс дээш зүйлд тэмдэглэгээ хийсэн бол дэлгэрэнгүй бичнэ үү.'};
  _s4.questions[5].translations.ne={text:'यदि प्रश्न 5 मा एक वा सोभन्दा बढी विषयमा चिन्ह लगाउनुभएको छ भने विस्तृत विवरण लेख्नुहोस्।'};
  _s4.questions[5].translations.id={text:'Jika Anda mencentang satu atau lebih item pada pertanyaan 5, jelaskan detailnya.'};
  _s4.questions[5].translations.ar={text:'إذا حددتم عنصراً واحداً أو أكثر في السؤال 5، يرجى كتابة التفاصيل.'};
  _s4.questions[5].translations.ur={text:'اگر آپ نے سوال 5 میں ایک یا ایک سے زیادہ آئٹمز پر نشان لگایا ہے تو تفصیلات لکھیں۔'};
  _s4.questions[5].translations.es={text:'Si marcó uno o más elementos en la pregunta 5, describa los detalles.'};
  _s4.questions[5].descTranslations.en='Example 1> Asthma symptoms in anxious environments, treated with oral corticosteroids.\nExample 2> Type 1 diabetes, regular blood sugar checks and insulin treatment.\nOptional.';_s4.questions[5].descTranslations.ru='Пример 1> Астма в стрессовой обстановке, лечение кортикостероидами.\nПример 2> Диабет 1-го типа, регулярный контроль сахара и инсулин.\nНеобязательный.';_s4.questions[5].descTranslations.vi='Ví dụ 1> Hen suyễn trong môi trường lo âu, điều trị corticosteroid.\nVí dụ 2> Tiểu đường tuýp 1, kiểm tra đường huyết và insulin.\nKhông bắt buộc.';_s4.questions[5].descTranslations.km='ឧទាហរណ៍ ១> ហឺតក្នុងបរិស្ថានព្រួយ ព្យាបាលដោយ corticosteroid។\nឧទាហរណ៍ ២> ទឹកនោមផ្អែមប្រភេទទី១ ពិនិត្យជាតិស្ករ និងអាំងស៊ុយលីន។\nជាជម្រើស។';_s4.questions[5].descTranslations.th='ตัวอย่าง 1> หอบหืดในสภาพแวดล้อมวิตกกังวล รักษาด้วยคอร์ติโคสเตียรอยด์\nตัวอย่าง 2> เบาหวานชนิดที่ 1 ตรวจน้ำตาลและรักษาด้วยอินซูลิน\nไม่บังคับ';_s4.questions[5].descTranslations.tl='Halimbawa 1> Hika sa nakakapag-alala na kapaligiran, ginagamot ng corticosteroid.\nHalimbawa 2> Type 1 diabetes, regular na blood sugar at insulin.\nOpsyonal.';_s4.questions[5].descTranslations.zh='示例1> 焦虑环境中哮喘，口服皮质类固醇治疗。\n示例2> 1型糖尿病，定期血糖检查和胰岛素治疗。\n选答题。';_s4.questions[5].descTranslations.ja='例1> 不安な環境で喘息、経口ステロイド治療中。\n例2> 1型糖尿病で血糖チェックとインスリン治療中。\n任意回答。';_s4.questions[5].descTranslations.mn='Жишээ 1> Түгшүүртэй орчинд багтраа, уухаар стероид эмчилгээ хийж буй.\nЖишээ 2> 1-р хэлбэрийн чихрийн шижин, тогтмол цусан дахь сахарын хэмжилт ба инсулин эмчилгээ хийж буй.\nСонголтот.';
  _s4.questions[5].descTranslations.ne='उदाहरण 1> चिन्ताजनक वातावरणमा दम, मुखबाट स्टेरोइड उपचार।\nउदाहरण 2> टाइप 1 मधुमेह, नियमित रगत चिनी जाँच र इन्सुलिन उपचार।\nवैकल्पिक।';_s4.questions[5].descTranslations.id='Contoh 1> Asma di lingkungan cemas, diobati kortikosteroid oral.\nContoh 2> Diabetes tipe 1, cek gula darah rutin dan insulin.\nOpsional.';_s4.questions[5].descTranslations.ar='مثال 1> ربو في بيئات القلق، يُعالج بالكورتيكوستيرويدات الفموية.\nمثال 2> سكري النوع الأول، فحص سكر الدم المنتظم وعلاج الأنسولين.\nاختياري.';_s4.questions[5].descTranslations.ur='مثال 1> پریشانی والے ماحول میں دمہ، زبانی سٹیرائیڈ علاج۔\nمثال 2> ٹائپ 1 ذیابیطس، باقاعدگی سے بلڈ شوگر چیک اور انسولین علاج۔\nاختیاری۔';_s4.questions[5].descTranslations.es='Ejemplo 1> Asma en ambientes de ansiedad, tratado con corticosteroides orales.\nEjemplo 2> Diabetes tipo 1, control regular de glucosa e insulina.\nOpcional.';

  /* ── s4b: 병력-2 (sections[6]) ── */
  const _s4b=svSurveyData.sections[6];
  if(!_s4b.titleTranslations) _s4b.titleTranslations={};
  if(!_s4b.descTranslations) _s4b.descTranslations={};
  _s4b.questions.forEach(function(q){if(!q.translations)q.translations={};if(!q.descTranslations)q.descTranslations={};});
  _s4b.titleTranslations.en='Medical History - 2';_s4b.titleTranslations.ru='История болезни - 2';_s4b.titleTranslations.vi='Tiền sử bệnh - 2';_s4b.titleTranslations.km='ប្រវត្តិជំងឺ - ២';_s4b.titleTranslations.th='ประวัติการเจ็บป่วย - 2';_s4b.titleTranslations.tl='Kasaysayang Medikal - 2';_s4b.titleTranslations.zh='病史 - 2';_s4b.titleTranslations.ja='病歴 - 2';_s4b.titleTranslations.mn='Өвчний түүх - 2';
  _s4b.titleTranslations.ne='चिकित्सा इतिहास - 2';_s4b.titleTranslations.id='Riwayat Medis - 2';_s4b.titleTranslations.ar='التاريخ الطبي - 2';_s4b.titleTranslations.ur='طبی تاریخ - 2';_s4b.titleTranslations.es='Historial Médico - 2';
  _s4b.questions[0].translations.en={text:'Please list all medications, substances, and foods that cause allergic reactions in the student.'};
  _s4b.questions[0].translations.ru={text:'Перечислите все лекарства, вещества и продукты, вызывающие аллергию у учащегося.'};
  _s4b.questions[0].translations.vi={text:'Vui lòng liệt kê tất cả thuốc, chất và thực phẩm gây dị ứng ở học sinh.'};
  _s4b.questions[0].translations.km={text:'សូមរាយនាមថ្នាំ សារធាតុ និងអាហារទាំងអស់ដែលបង្កអាឡែស៊ីចំពោះសិស្ស។'};
  _s4b.questions[0].translations.th={text:'กรุณาระบุยา สาร และอาหารทั้งหมดที่ทำให้นักเรียนเกิดอาการแพ้'};
  _s4b.questions[0].translations.tl={text:'Mangyaring ilista ang lahat ng gamot, substance, at pagkain na nagdudulot ng allergic reaction sa estudyante.'};
  _s4b.questions[0].translations.zh={text:'请列出所有会导致学生过敏的药物、物质和食物。'};
  _s4b.questions[0].translations.ja={text:'アレルギー症状を引き起こす薬物、物質、食品をすべて記入してください。'};
  _s4b.questions[0].translations.mn={text:'Харшлын шинж тэмдэг үүсгэдэг бүх эм, бодис, хоол хүнсийг бичнэ үү.'};
  _s4b.questions[0].translations.ne={text:'विद्यार्थीमा एलर्जिक प्रतिक्रिया उत्पन्न गर्ने सबै औषधि, पदार्थ र खाद्य पदार्थ लेख्नुहोस्।'};
  _s4b.questions[0].translations.id={text:'Sebutkan semua obat, zat, dan makanan yang menyebabkan reaksi alergi pada siswa.'};
  _s4b.questions[0].translations.ar={text:'يرجى ذكر جميع الأدوية والمواد والأطعمة التي تسبب تفاعلات حساسية لدى الطالب.'};
  _s4b.questions[0].translations.ur={text:'طالب علم میں الرجک ردعمل پیدا کرنے والی تمام ادویات، مادے اور غذائیں لکھیں۔'};
  _s4b.questions[0].translations.es={text:'Enumere todos los medicamentos, sustancias y alimentos que causan reacciones alérgicas en el estudiante.'};
  _s4b.questions[0].descTranslations.en='Example> Peanuts, ibuprofen, cat hair...\nOptional.';_s4b.questions[0].descTranslations.ru='Пример> Арахис, ибупрофен, кошачья шерсть…\nНеобязательный.';_s4b.questions[0].descTranslations.vi='Ví dụ> Đậu phộng, ibuprofen, lông mèo…\nKhông bắt buộc.';_s4b.questions[0].descTranslations.km='ឧទាហរណ៍> សណ្តែកដី អ៊ីប៊ូប្រូហ្វែន រោមឆ្មា…\nជាជម្រើស។';_s4b.questions[0].descTranslations.th='ตัวอย่าง> ถั่วลิสง ไอบูโพรเฟน ขนแมว…\nไม่บังคับ';_s4b.questions[0].descTranslations.tl='Halimbawa> Mani, ibuprofen, balahibo ng pusa…\nOpsyonal.';_s4b.questions[0].descTranslations.zh='示例> 花生、布洛芬、猫毛……\n选答题。';_s4b.questions[0].descTranslations.ja='例> ピーナッツ、イブプロフェン、猫の毛…\n任意回答。';_s4b.questions[0].descTranslations.mn='Жишээ> Газрын самар, ибупрофен, муурны үс…\nСонголтот.';
  _s4b.questions[0].descTranslations.ne='उदाहरण> बदाम, आइबुप्रोफेन, बिरालोको भुत्ला…\nवैकल्पिक।';_s4b.questions[0].descTranslations.id='Contoh> Kacang tanah, ibuprofen, bulu kucing…\nOpsional.';_s4b.questions[0].descTranslations.ar='مثال> فول سوداني، إيبوبروفين، شعر القطط…\nاختياري.';_s4b.questions[0].descTranslations.ur='مثال> مونگ پھلی، آئیبوپروفین، بلی کے بال…\nاختیاری۔';_s4b.questions[0].descTranslations.es='Ejemplo> Cacahuetes, ibuprofeno, pelo de gato…\nOpcional.';
  _s4b.questions[1].translations.en={text:'Has the student ever experienced anaphylaxis?',options:['Yes','No']};
  _s4b.questions[1].translations.ru={text:'Испытывал ли учащийся анафилаксию?',options:['Да','Нет']};
  _s4b.questions[1].translations.vi={text:'Học sinh đã từng bị sốc phản vệ chưa?',options:['Có','Không']};
  _s4b.questions[1].translations.km={text:'តើសិស្សធ្លាប់មានអាណាហ្វីឡាក់ស៊ីសដែរឬទេ?',options:['បាទ/ចាស','ទេ']};
  _s4b.questions[1].translations.th={text:'นักเรียนเคยมีอาการแพ้รุนแรง (anaphylaxis) หรือไม่?',options:['ใช่','ไม่ใช่']};
  _s4b.questions[1].translations.tl={text:'Ang estudyante ba ay nakaranas na ng anaphylaxis?',options:['Oo','Hindi']};
  _s4b.questions[1].translations.zh={text:'学生是否曾经历过过敏性休克？',options:['是','否']};
  _s4b.questions[1].translations.ja={text:'アナフィラキシーを経験したことがありますか？',options:['はい','いいえ']};
  _s4b.questions[1].translations.mn={text:'Анафилаксис (хүнд харшил) туулж байсан уу?',options:['Тийм','Үгүй']};
  _s4b.questions[1].translations.ne={text:'के विद्यार्थीले एनाफिलेक्सिस (गम्भीर एलर्जी) अनुभव गरेको छ?',options:['छ','छैन']};
  _s4b.questions[1].translations.id={text:'Apakah siswa pernah mengalami anafilaksis?',options:['Ya','Tidak']};
  _s4b.questions[1].translations.ar={text:'هل سبق للطالب أن أصيب بصدمة الحساسية المفرطة (أنافيلاكسيس)؟',options:['نعم','لا']};
  _s4b.questions[1].translations.ur={text:'کیا طالب علم کو کبھی انافلیکسس (شدید الرجی) ہوئی ہے؟',options:['ہاں','نہیں']};
  _s4b.questions[1].translations.es={text:'¿Ha experimentado el estudiante anafilaxia (reacción alérgica grave)?',options:['Sí','No']};
  _s4b.questions[1].descTranslations.en='Anaphylaxis is a severe allergic reaction where even a tiny amount of a substance can cause symptoms throughout the body, including coughing, chest pain, tingling, rapid pulse, rash, and vomiting, typically within 1 hour of contact.';_s4b.questions[1].descTranslations.ru='Анафилаксия — тяжёлая аллергическая реакция, при которой даже минимальный контакт может вызвать симптомы по всему телу: кашель, боль в груди, покалывание, учащённый пульс, сыпь и рвоту, обычно в течение 1 часа.';_s4b.questions[1].descTranslations.vi='Sốc phản vệ là phản ứng dị ứng nghiêm trọng, chỉ cần tiếp xúc lượng rất nhỏ cũng gây triệu chứng toàn thân: ho, đau ngực, tê, mạch nhanh, phát ban, nôn, thường trong vòng 1 giờ.';_s4b.questions[1].descTranslations.km='អាណាហ្វីឡាក់ស៊ីសគឺជាប្រតិកម្មអាឡែស៊ីធ្ងន់ធ្ងរ សូម្បីតែប៉ះពាល់តិចតួចក៏បង្កឱ្យមានរោគសញ្ញាពាសពេញរាងកាយ: ក្អក ឈឺទ្រូង ស្ពឹក បេះដូងលោតលឿន រមាស់ និងក្អួត ជាធម្មតាក្នុងរយៈពេល ១ ម៉ោង។';_s4b.questions[1].descTranslations.th='อาการแพ้รุนแรงคือปฏิกิริยาภูมิแพ้รุนแรง แม้สัมผัสเพียงเล็กน้อยก็อาจเกิดอาการทั่วร่างกาย: ไอ เจ็บหน้าอก ชา หัวใจเต้นเร็ว ผื่น อาเจียน มักภายใน 1 ชั่วโมง';_s4b.questions[1].descTranslations.tl='Ang anaphylaxis ay matinding reaksyong alerhiya kung saan kahit napakaliit na halaga ay nagdudulot ng sintomas sa buong katawan: ubo, pananakit ng dibdib, pamamanhid, mabilis na pulso, pamamantal, pagsusuka, karaniwang sa loob ng 1 oras.';_s4b.questions[1].descTranslations.zh='过敏性休克是严重过敏反应，即使接触极微量也可能导致全身症状：咳嗽、胸痛、刺痛、心跳加速、皮疹、呕吐，通常在1小时内出现。';_s4b.questions[1].descTranslations.ja='アナフィラキシーとは極微量でも全身症状が現れる深刻なアレルギー反応で、接触後おおむね1時間以内に咳、胸痛、しびれ、頻脈、発疹、嘔吐などが現れます。';_s4b.questions[1].descTranslations.mn='Анафилаксис нь маш бага хэмжээний бодистой хүрэлцсэнээр бүх биеэр шинж тэмдэг илэрдэг хүнд харшлын урвал бөгөөд хүрэлцсэнээс хойш ихэвчлэн 1 цагийн дотор ханиалга, цээжний өвдөлт, гар хөл мэдрэхгүй болох, зүрхний цохилт хурдсах, тууралт, бөөлжих зэрэг шинж тэмдэг илэрдэг.';
  _s4b.questions[1].descTranslations.ne='एनाफिलेक्सिस एक गम्भीर एलर्जिक प्रतिक्रिया हो जहाँ अत्यन्तै थोरै मात्रामा पनि सम्पूर्ण शरीरमा लक्षणहरू देखिन्छन् जस्तै खोकी, छातीमा दुखाइ, झनझनाहट, छिटो नाडी, छाला फुस्रो, वमन — सामान्यतया 1 घण्टाभित्र।';_s4b.questions[1].descTranslations.id='Anafilaksis adalah reaksi alergi parah di mana meskipun terpapar zat dalam jumlah sangat kecil dapat menimbulkan gejala di seluruh tubuh: batuk, nyeri dada, kesemutan, denyut nadi cepat, ruam, dan muntah, biasanya dalam 1 jam.';_s4b.questions[1].descTranslations.ar='الحساسية المفرطة هي تفاعل تحسسي شديد حيث يمكن لكمية صغيرة جداً من المادة أن تسبب أعراضاً في جميع أنحاء الجسم: سعال، ألم في الصدر، وخز، نبض سريع، طفح جلدي، وقيء، عادةً خلال ساعة واحدة.';_s4b.questions[1].descTranslations.ur='انافلیکسس ایک شدید الرجک ردعمل ہے جس میں بہت کم مقدار میں مادے سے بھی پورے جسم میں علامات ظاہر ہوتی ہیں: کھانسی، سینے میں درد، جھنجھناہٹ، تیز نبض، جلد پر دانے، قے — عام طور پر 1 گھنٹے کے اندر۔';_s4b.questions[1].descTranslations.es='La anafilaxia es una reacción alérgica grave en la que incluso una cantidad mínima de una sustancia puede causar síntomas en todo el cuerpo: tos, dolor de pecho, hormigueo, pulso rápido, erupción y vómitos, generalmente dentro de 1 hora.';
  _s4b.questions[2].translations.en={text:'If the student is continuously taking any medication for treatment, please specify.'};
  _s4b.questions[2].translations.ru={text:'Если учащийся постоянно принимает лекарства, укажите их.'};
  _s4b.questions[2].translations.vi={text:'Nếu học sinh đang dùng thuốc liên tục để điều trị, vui lòng ghi rõ.'};
  _s4b.questions[2].translations.km={text:'ប្រសិនបើសិស្សកំពុងប្រើថ្នាំជាប់ជានិច្ច សូមបញ្ជាក់។'};
  _s4b.questions[2].translations.th={text:'หากนักเรียนมียาที่ต้องรับประทานต่อเนื่อง กรุณาระบุ'};
  _s4b.questions[2].translations.tl={text:'Kung ang estudyante ay patuloy na umiinom ng gamot, mangyaring tukuyin.'};
  _s4b.questions[2].translations.zh={text:'如果学生因治疗需要持续服药，请注明。'};
  _s4b.questions[2].translations.ja={text:'治療目的で継続服用している薬がある場合、記入してください。'};
  _s4b.questions[2].translations.mn={text:'Эмчилгээний зорилгоор сурагч тогтмол уудаг эм байвал бичнэ үү.'};
  _s4b.questions[2].translations.ne={text:'यदि विद्यार्थीले उपचारको लागि निरन्तर औषधि सेवन गर्दछन् भने उल्लेख गर्नुहोस्।'};
  _s4b.questions[2].translations.id={text:'Jika siswa secara rutin mengonsumsi obat untuk pengobatan, sebutkan.'};
  _s4b.questions[2].translations.ar={text:'إذا كان الطالب يتناول أدوية بشكل مستمر للعلاج، يرجى تحديدها.'};
  _s4b.questions[2].translations.ur={text:'اگر طالب علم علاج کے لیے مسلسل کوئی دوائی لے رہا ہے تو بیان کریں۔'};
  _s4b.questions[2].translations.es={text:'Si el estudiante toma algún medicamento de forma continua para tratamiento, especifíquelo.'};
  _s4b.questions[2].descTranslations.en='Optional.';_s4b.questions[2].descTranslations.ru='Необязательный.';_s4b.questions[2].descTranslations.vi='Không bắt buộc.';_s4b.questions[2].descTranslations.km='ជាជម្រើស។';_s4b.questions[2].descTranslations.th='ไม่บังคับ';_s4b.questions[2].descTranslations.tl='Opsyonal.';_s4b.questions[2].descTranslations.zh='选答题。';_s4b.questions[2].descTranslations.ja='任意回答。';_s4b.questions[2].descTranslations.mn='Сонголтот.';
  _s4b.questions[2].descTranslations.ne='वैकल्पिक।';_s4b.questions[2].descTranslations.id='Opsional.';_s4b.questions[2].descTranslations.ar='اختياري.';_s4b.questions[2].descTranslations.ur='اختیاری۔';_s4b.questions[2].descTranslations.es='Opcional.';
  _s4b.questions[3].translations.en={text:'If the student is currently being treated at a hospital, please specify which hospital.'};
  _s4b.questions[3].translations.ru={text:'Если учащийся проходит лечение в больнице, укажите, в какой.'};
  _s4b.questions[3].translations.vi={text:'Nếu học sinh đang điều trị tại bệnh viện, vui lòng ghi rõ.'};
  _s4b.questions[3].translations.km={text:'ប្រសិនបើសិស្សកំពុងព្យាបាលនៅមន្ទីរពេទ្យ សូមបញ្ជាក់ឈ្មោះ។'};
  _s4b.questions[3].translations.th={text:'หากนักเรียนรับการรักษาที่โรงพยาบาลอยู่ กรุณาระบุชื่อ'};
  _s4b.questions[3].translations.tl={text:'Kung kasalukuyang nagpapagamot sa ospital, mangyaring tukuyin.'};
  _s4b.questions[3].translations.zh={text:'如果学生目前正在医院治疗，请注明医院名称。'};
  _s4b.questions[3].translations.ja={text:'現在治療中の病院がある場合、記入してください。'};
  _s4b.questions[3].translations.mn={text:'Одоогоор эмчилгээ хийлгэж буй эмнэлэг байвал аль эмнэлэг болохыг бичнэ үү.'};
  _s4b.questions[3].translations.ne={text:'यदि विद्यार्थी हाल अस्पतालमा उपचार गराउँदैछन् भने कुन अस्पताल हो उल्लेख गर्नुहोस्।'};
  _s4b.questions[3].translations.id={text:'Jika siswa saat ini sedang berobat di rumah sakit, sebutkan rumah sakitnya.'};
  _s4b.questions[3].translations.ar={text:'إذا كان الطالب يتلقى حالياً علاجاً في مستشفى، يرجى ذكر اسم المستشفى.'};
  _s4b.questions[3].translations.ur={text:'اگر طالب علم فی الحال کسی ہسپتال میں زیر علاج ہے تو ہسپتال کا نام لکھیں۔'};
  _s4b.questions[3].translations.es={text:'Si el estudiante está actualmente en tratamiento en un hospital, especifique cuál.'};
  _s4b.questions[3].descTranslations.en='Optional.';_s4b.questions[3].descTranslations.ru='Необязательный.';_s4b.questions[3].descTranslations.vi='Không bắt buộc.';_s4b.questions[3].descTranslations.km='ជាជម្រើស។';_s4b.questions[3].descTranslations.th='ไม่บังคับ';_s4b.questions[3].descTranslations.tl='Opsyonal.';_s4b.questions[3].descTranslations.zh='选答题。';_s4b.questions[3].descTranslations.ja='任意回答。';_s4b.questions[3].descTranslations.mn='Сонголтот.';
  _s4b.questions[3].descTranslations.ne='वैकल्पिक।';_s4b.questions[3].descTranslations.id='Opsional.';_s4b.questions[3].descTranslations.ar='اختياري.';_s4b.questions[3].descTranslations.ur='اختیاری۔';_s4b.questions[3].descTranslations.es='Opcional.';
  _s4b.questions[4].translations.en={text:'If there are health-related considerations the school should accommodate or matters you want staff to know, please describe.'};
  _s4b.questions[4].translations.ru={text:'Если есть моменты, связанные со здоровьем, которые школа должна учитывать, опишите подробно.'};
  _s4b.questions[4].translations.vi={text:'Nếu có điều liên quan đến sức khỏe mà trường cần lưu ý, vui lòng mô tả chi tiết.'};
  _s4b.questions[4].translations.km={text:'ប្រសិនបើមានចំណុចសុខភាពដែលសាលាគួរយកចិត្តទុកដាក់ សូមពិពណ៌នាលម្អិត។'};
  _s4b.questions[4].translations.th={text:'หากมีข้อควรพิจารณาด้านสุขภาพที่โรงเรียนควรดูแลเป็นพิเศษ กรุณาระบุ'};
  _s4b.questions[4].translations.tl={text:'Kung may health-related na bagay na dapat bigyang-pansin ng paaralan, mangyaring ilarawan.'};
  _s4b.questions[4].translations.zh={text:'如果学生因健康原因需要学校特别照顾，请详细描述。'};
  _s4b.questions[4].translations.ja={text:'健康上の理由で学校が配慮すべき点があれば、詳しく記入してください。'};
  _s4b.questions[4].translations.mn={text:'Сурагчийн эрүүл мэндийн шалтгаанаар сургуулиас тусгайлан анхаарах зүйл байвал дэлгэрэнгүй бичнэ үү.'};
  _s4b.questions[4].translations.ne={text:'यदि विद्यार्थीको स्वास्थ्य कारणले विद्यालयले विशेष ध्यान दिनुपर्ने कुरा छ भने विस्तृत विवरण लेख्नुहोस्।'};
  _s4b.questions[4].translations.id={text:'Jika ada hal terkait kesehatan yang perlu diperhatikan khusus oleh sekolah, jelaskan detailnya.'};
  _s4b.questions[4].translations.ar={text:'إذا كانت هناك اعتبارات صحية يجب أن تراعيها المدرسة أو أمور تريدون إبلاغ الموظفين بها، يرجى الوصف.'};
  _s4b.questions[4].translations.ur={text:'اگر طالب علم کی صحت کی وجہ سے اسکول کو خصوصی توجہ دینے والی کوئی بات ہے تو تفصیلات لکھیں۔'};
  _s4b.questions[4].translations.es={text:'Si hay consideraciones de salud que la escuela deba tener en cuenta o asuntos que desee comunicar al personal, descríbalos.'};
  _s4b.questions[4].descTranslations.en='Example> Please contact parents if the student shows high blood sugar symptoms.\nOptional.';_s4b.questions[4].descTranslations.ru='Пример> Свяжитесь с родителями при симптомах повышенного сахара.\nНеобязательный.';_s4b.questions[4].descTranslations.vi='Ví dụ> Liên hệ phụ huynh nếu học sinh có biểu hiện tăng đường huyết.\nKhông bắt buộc.';_s4b.questions[4].descTranslations.km='ឧទាហរណ៍> សូមទាក់ទងអាណាព្យាបាលប្រសិនបើសិស្សបង្ហាញរោគសញ្ញានៃជាតិស្ករខ្ពស់។\nជាជម្រើស។';_s4b.questions[4].descTranslations.th='ตัวอย่าง> กรุณาติดต่อผู้ปกครองหากนักเรียนแสดงอาการน้ำตาลในเลือดสูง\nไม่บังคับ';_s4b.questions[4].descTranslations.tl='Halimbawa> Kontakin ang magulang kung nagpapakita ng mataas na blood sugar.\nOpsyonal.';_s4b.questions[4].descTranslations.zh='示例> 如出现高血糖症状请联系家长。\n选答题。';_s4b.questions[4].descTranslations.ja='例> 高血糖症状が見られたら保護者に連絡してください。\n任意回答。';_s4b.questions[4].descTranslations.mn='Жишээ> Цусан дахь сахар ихэссэн шинж тэмдэг илэрвэл эцэг эхтэй холбоо барина уу.\nСонголтот.';
  _s4b.questions[4].descTranslations.ne='उदाहरण> उच्च रक्त शर्करा लक्षण देखिएमा अभिभावकलाई सम्पर्क गर्नुहोस्।\nवैकल्पिक।';_s4b.questions[4].descTranslations.id='Contoh> Hubungi orang tua jika siswa menunjukkan gejala gula darah tinggi.\nOpsional.';_s4b.questions[4].descTranslations.ar='مثال> يرجى التواصل مع أولياء الأمور إذا ظهرت أعراض ارتفاع السكر في الدم.\nاختياري.';_s4b.questions[4].descTranslations.ur='مثال> اگر ہائی بلڈ شوگر کی علامات ظاہر ہوں تو والدین سے رابطہ کریں۔\nاختیاری۔';_s4b.questions[4].descTranslations.es='Ejemplo> Contactar a los padres si el estudiante presenta síntomas de hiperglucemia.\nOpcional.';
  /* ── translations 객체의 options를 optionTranslations로 동기화 ── */
  svSurveyData.sections.forEach(function(sec){
    sec.questions.forEach(function(q){
      if(!q.optionTranslations)q.optionTranslations={};
      if(!q.translations)return;
      Object.keys(q.translations).forEach(function(lc){
        const tr=q.translations[lc];
        if(tr&&typeof tr==='object'&&tr.options){
          tr.options.forEach(function(optText,oi){
            if(!q.optionTranslations[oi])q.optionTranslations[oi]={};
            if(!q.optionTranslations[oi][lc])q.optionTranslations[oi][lc]=optText;
          });
          /* gridRows/gridCols도 동기화 */
          if(tr.gridRows){
            if(!q.gridRowTranslations)q.gridRowTranslations={};
            tr.gridRows.forEach(function(rt,ri){
              if(!q.gridRowTranslations[ri])q.gridRowTranslations[ri]={};
              if(!q.gridRowTranslations[ri][lc])q.gridRowTranslations[ri][lc]=rt;
            });
          }
          if(tr.gridCols){
            if(!q.gridColTranslations)q.gridColTranslations={};
            tr.gridCols.forEach(function(ct,ci){
              if(!q.gridColTranslations[ci])q.gridColTranslations[ci]={};
              if(!q.gridColTranslations[ci][lc])q.gridColTranslations[ci][lc]=ct;
            });
          }
        }
      });
    });
  });
}

function svAutoSave(){
  _asScheduleSave(svSurveyData,300);
  bus.emit('toast:saveLater');
}
let svFocusedQ=null;
function svRenderQuestionEditor(scrollToQid){
  const el=document.getElementById('sv-wizard-step-4');if(!el)return;
  el.removeEventListener('input',svAutoSave);
  el.addEventListener('input',svAutoSave);
  svInitSurveyData();const d=svSurveyData;
  const wrap=el.querySelector('.sv-editor-wrap');
  const prevScroll=wrap?wrap.scrollTop:0;
  let h='<div style="position:sticky;top:0;z-index:10;background:var(--bg);padding:8px 0 12px;display:flex;align-items:center;justify-content:flex-end;gap:8px"><button class="sv-btn" data-sv-click="wizardStep" data-sv-step="3">← 이전</button><button class="sv-btn-primary" data-sv-click="previewSurvey"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:3px"><path d="M2.5 12c2.2-3.1 5.5-5 9.5-5s7.3 1.9 9.5 5c-2.2 3.1-5.5 5-9.5 5s-7.3-1.9-9.5-5Z"></path><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"></circle></svg> 미리보기 &amp; 설문 생성 완료</button></div>';
  h+='<div class="sv-editor-wrap" id="svEditorScroll">';
  if(!d.startDate){const td=new Date();d.startDate=toDateStr(td);const ed=new Date(td);ed.setDate(ed.getDate()+14);d.endDate=toDateStr(ed);}
  h+='<div class="sv-section-card" style="margin-bottom:14px"><input class="sv-section-title-input" value="'+escHtml(d.title)+'" data-sv-input="setTitle" placeholder="설문 제목을 입력하세요">'
    +'<textarea class="sv-section-desc-input" data-sv-input="setDesc" placeholder="설문에 대한 설명을 입력하세요" style="white-space:pre-wrap;resize:none;min-height:20px">'+escHtml(d.desc)+'</textarea>'
    +'<div style="display:flex;gap:12px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--bdr)">'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;font-weight:600;color:var(--t2)">시작일</span><input id="svStartDate" class="form-input" value="'+d.startDate+'" placeholder="YYYY-MM-DD" style="font-size:11px;padding:4px 8px" data-sv-input="setStartDate" data-sv-click="stopProp"><button type="button" data-sv-click="openCal" data-sv-field="svStartDate" style="border:1px solid var(--bdr);background:var(--bg2);border-radius:4px;padding:2px 5px;cursor:pointer;font-size:12px;flex-shrink:0">📅</button></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;font-weight:600;color:var(--t2)">마감일</span><input id="svEndDate" class="form-input" value="'+d.endDate+'" placeholder="YYYY-MM-DD" style="font-size:11px;padding:4px 8px" data-sv-input="setEndDate" data-sv-click="stopProp"><button type="button" data-sv-click="openCal" data-sv-field="svEndDate" style="border:1px solid var(--bdr);background:var(--bg2);border-radius:4px;padding:2px 5px;cursor:pointer;font-size:12px;flex-shrink:0">📅</button></div>'
    +'<div style="display:flex;align-items:center;gap:6px"><span style="font-size:11px;font-weight:600;color:var(--t2)">마감시간</span><div class="sv-toggle'+(d.hasEndTime?' on':'')+'" data-sv-click="toggleEndTime"></div>'
    +'<div id="svEndTimeWrap" style="display:'+(d.hasEndTime?'flex':'none')+';align-items:center;gap:4px"><input id="svEndTime" class="form-input" value="'+(d.endTime||'')+'" placeholder="HH:MM" style="font-size:11px;padding:4px 8px;width:70px" data-sv-input="setEndTime" data-sv-click="stopProp" data-sv-blur="formatTimeInput" data-sv-keydown="formatTimeOnEnter"><button type="button" data-sv-click="openClockPicker" data-sv-field="svEndTime" style="border:1px solid var(--bdr);background:var(--bg2);border-radius:4px;padding:2px 5px;cursor:pointer;font-size:12px;flex-shrink:0">🕐</button></div></div>'
    +'</div></div>';
  /* 응답자에게 자동 표시되는 기본 문항 안내 */
  let autoQNum=0;
  const _autoQLangTrans={
    langQ:{en:'Which language would you like to respond in?',ru:'На каком языке вы хотите отвечать?',vi:'Bạn muốn trả lời bằng ngôn ngữ nào?',km:'តើអ្នកចង់ឆ្លើយតបជាភាសាអ្វី?',th:'คุณต้องการตอบเป็นภาษาอะไร?',tl:'Anong wika ang gusto mong sagutin?',zh:'请问您希望使用哪种语言作答？',ja:'どの言語で回答されますか？',mn:'Та аль хэлээр хариулахыг хүсч байна вэ?',ne:'तपाईं कुन भाषामा उत्तर दिन चाहनुहुन्छ?',id:'Dalam bahasa apa Anda ingin menjawab?',ar:'بأي لغة تود الإجابة؟',ur:'آپ کس زبان میں جواب دینا چاہیں گے؟',es:'¿En qué idioma desea responder?'},
    childQ:{en:'How many of your children attend our school?',ru:'Сколько ваших детей учатся в нашей школе?',vi:'Bạn có bao nhiêu con đang học tại trường chúng tôi?',km:'តើកូនរបស់អ្នកប៉ុន្មាននាក់រៀននៅសាលារបស់យើង?',th:'บุตรหลานของท่านกี่คนที่เรียนอยู่ที่โรงเรียนของเรา?',tl:'Ilang anak mo ang nag-aaral sa aming paaralan?',zh:'请问您有几个孩子在本校就读？',ja:'お子さまは何名本校に通われていますか？',mn:'Таны хэдэн хүүхэд манай сургуульд сурдаг вэ?',ne:'तपाईंका कति जना सन्तान हाम्रो विद्यालयमा पढ्दछन्?',id:'Berapa anak Anda yang bersekolah di sekolah kami?',ar:'كم عدد أبنائكم الملتحقين بمدرستنا؟',ur:'آپ کے کتنے بچے ہمارے اسکول میں پڑھتے ہیں؟',es:'¿Cuántos de sus hijos asisten a nuestra escuela?'},
    childOpt:{en:'{n} child(ren)',ru:'{n} ребёнок/детей',vi:'{n} con',km:'កូន {n} នាក់',th:'{n} คน',tl:'{n} anak',zh:'{n}名',ja:'{n}名',mn:'{n} хүүхэд',ne:'{n} जना',id:'{n} anak',ar:'{n} طفل/أطفال',ur:'{n} بچے',es:'{n} hijo(s)'}
  };
  const _autoQFlags={ko:_FLAG_KO,en:'🇺🇸',ru:'🇷🇺',vi:'🇻🇳',km:_FLAG_KM,th:'🇹🇭',tl:'🇵🇭',zh:_FLAG_CN,ja:'🇯🇵',mn:_FLAG_MN,ne:'🇳🇵',id:'🇮🇩',ar:_FLAG_SA,ur:'🇵🇰',es:_FLAG_ES};
  if(svWizardSelectedLangs.length>1){
    autoQNum++;
    h+='<div style="border:1px dashed var(--cyan);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:rgba(6,182,212,0.04)">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:11px;font-weight:700;color:var(--cyan)">자동 Q'+autoQNum+'</span><span style="font-size:10px;color:var(--t3);background:var(--bg2);padding:2px 8px;border-radius:4px">응답자에게 자동 표시</span></div>'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px;line-height:1">'+_FLAG_KO+'</span><span style="font-size:13px;font-weight:600;color:var(--t1)">어떤 언어로 응답하시겠습니까?</span></div>';
    svWizardSelectedLangs.forEach(function(lc){
      if(lc==='ko')return;
      const tr=_autoQLangTrans.langQ[lc]||'';
      h+='<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="font-size:14px;line-height:1">'+(_autoQFlags[lc]||'')+'</span><span style="font-size:12px;color:var(--t2)">'+escHtml(tr)+'</span></div>';
    });
    h+='<div style="font-size:11px;color:var(--t3);margin-top:8px;padding-top:6px;border-top:1px solid var(--bdr)">선택지: ';
    svWizardSelectedLangs.forEach(function(lc,i){
      if(i>0)h+=' / ';
      h+=(_autoQFlags[lc]||'')+' '+(({ko:'한국어',en:'English',ru:'Русский',vi:'Tiếng Việt',km:'ភាសាខ្មែរ',th:'ภาษาไทย',tl:'Filipino',zh:'中文',ja:'日本語',mn:'Монгол',ne:'नेपाली',id:'Bahasa Indonesia',ar:'العربية',ur:'اردو',es:'Español'})[lc]||lc);
    });
    h+='</div></div>';
  }
  autoQNum++;
  const schoolName=(S.settings.school||'본교');
  h+='<div style="border:1px dashed var(--cyan);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:rgba(6,182,212,0.04)">'
    +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:11px;font-weight:700;color:var(--cyan)">자동 Q'+autoQNum+'</span><span style="font-size:10px;color:var(--t3);background:var(--bg2);padding:2px 8px;border-radius:4px">응답자에게 자동 표시</span></div>'
    +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:14px;line-height:1">'+_FLAG_KO+'</span><span style="font-size:13px;font-weight:600;color:var(--t1)">우리 학교에 다니고 있는 귀하의 자녀가 몇 명인가요?</span></div>';
  if(svWizardSelectedLangs.length>1){
    svWizardSelectedLangs.forEach(function(lc){
      if(lc==='ko')return;
      const tr=_autoQLangTrans.childQ[lc]||'';
      h+='<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="font-size:14px;line-height:1">'+(_autoQFlags[lc]||'')+'</span><span style="font-size:12px;color:var(--t2)">'+escHtml(tr)+'</span></div>';
    });
  }
  h+='<div style="font-size:11px;color:var(--t3);margin-top:8px;padding-top:6px;border-top:1px solid var(--bdr)">선택지: 1명 ~ 10명 (선택 후 자녀별 학년·반·번호·이름 입력 → 학생 데이터와 자동 매칭)</div>'
    +'</div>';

  let qNum=0;
  d.sections.forEach(function(sec,si){
    {
      h+='<div class="sv-section-card"><div style="display:flex;justify-content:space-between;align-items:flex-start">'
        +'<div style="flex:1"><input class="sv-section-title-input" value="'+escHtml(sec.title)+'" data-sv-input="setSectionTitle" data-sv-si="'+si+'" placeholder="섹션 제목">'
        +'<div id="svSecDescToolbar'+si+'" style="display:none;gap:2px;align-items:center;padding:4px 0;flex-wrap:wrap">'
        +'<select class="sv-rich-size" data-sv-change="execCmdVal" data-sv-cmd="fontName" title="글씨체"><option>Noto Sans KR</option><option>맑은 고딕</option><option>바탕</option><option>궁서</option></select>'
        +'<select class="sv-rich-size" data-sv-change="execCmdVal" data-sv-cmd="fontSize" title="크기"><option value="1">10</option><option value="2">13</option><option value="3" selected>16</option><option value="4">18</option><option value="5">24</option></select>'
        +'<div class="sv-rich-sep"></div>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="bold" title="굵게"><b>B</b></button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="italic" title="기울임"><i>I</i></button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="underline" title="밑줄"><u>U</u></button>'
        +'<div class="sv-rich-sep"></div>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="insertOrderedList" title="번호 목록">1.</button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="insertUnorderedList" title="점 목록">•</button>'
        +'</div>'
        +'<div class="sv-q-desc-edit" id="svSecDescEdit'+si+'" contenteditable="true" style="min-height:16px;outline:none;font-size:12px;color:var(--t2);font-family:var(--f);line-height:1.6;border-bottom:1px solid transparent;padding:3px 0;transition:border-color .2s" data-sv-focus="showSecDescToolbar" data-sv-si="'+si+'" data-sv-input="setSectionDesc" data-sv-si="'+si+'">'+((sec.desc||'').replace(/\n/g,'<br>')||'<span style="color:var(--t3);opacity:0.5">섹션 설명 (선택)</span>')+'</div>';
      /* 섹션 설명 다국어 번역 입력 — 아코디언 */
      if(svWizardSelectedLangs.length>1&&sec.desc){
        if(!sec.descTranslations)sec.descTranslations={};
        const _secLangMeta={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
        /* 완료 상태 계산 */
        let _sdDoneCount=0, _sdTotalCount=0;
        svWizardSelectedLangs.forEach(function(lc){if(lc==='ko')return;_sdTotalCount++;if(sec.descTranslations[lc]&&sec.descTranslations[lc].trim())_sdDoneCount++;});
        const _sdAllDone=_sdDoneCount===_sdTotalCount&&_sdTotalCount>0;
        h+='<div style="margin-top:8px">'
          +'<div class="set-accordion" data-sv-click="toggleSecDescAcc" style="padding:8px 12px;font-size:11px">'
          +'<span style="display:flex;align-items:center;gap:6px">🌐 설명 번역 <span id="svSecDescBadge_'+si+'" style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:'+(_sdAllDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)')+';color:'+(_sdAllDone?'var(--gs)':'var(--cyan)')+'">'+_sdDoneCount+'/'+_sdTotalCount+'</span></span>'
          +'<span class="set-acc-arrow">▼</span></div>'
          +'<div class="set-accordion-body" id="svSecDescLang_'+si+'">';
        svWizardSelectedLangs.forEach(function(lc){
          if(lc==='ko')return;
          const lm=_secLangMeta[lc]||{name:lc,flag:''};
          const dtv=sec.descTranslations[lc]||'';
          const hasDescTrans=dtv.trim().length>0;
          h+='<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bdrl)">'
            +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">'
            +'<span style="font-size:16px;line-height:1">'+lm.flag+'</span>'
            +'<span style="font-size:11px;font-weight:600;color:var(--t2)">'+lm.name+'</span>'
            +'<span id="svSecDescDot_'+si+'_'+lc+'" style="width:10px;height:10px;border-radius:50%;background:'+(hasDescTrans?'#22c55e':'#aaa')+';flex-shrink:0;transition:background .2s"></span>'
            +'<button class="sv-btn sv-btn-sm" data-sv-click="secDescOpenPrompt" data-sv-si="'+si+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px;margin-left:auto" title="프롬프트 미리보기 및 편집">🔍 프롬프트 미리보기</button>'
            +'<button class="sv-btn sv-btn-sm" data-sv-click="secDescCopyPrompt" data-sv-si="'+si+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px" title="프롬프트를 바로 클립보드에 복사">📋 프롬프트 복사</button>'
            +'</div>'
            +'<textarea class="sv-section-desc-input" data-sv-input="secDescTrans" data-sv-si="'+si+'" data-sv-lc="'+lc+'" placeholder="'+lm.name+' 번역을 붙여넣기 하세요" style="width:100%;white-space:pre-wrap;resize:none;min-height:50px;font-size:11px">'+escHtml(dtv)+'</textarea>'
            +'</div>';
        });
        h+='</div></div>';
      }
      h+='</div>'
        +'<span style="width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:8px;border:1px solid rgba(239,68,68,0.2);line-height:1;margin-left:8px;flex-shrink:0" title="섹션 삭제" data-sv-click="deleteSection" data-sv-si="'+si+'">✕</span>'
        +'</div></div>';
    }
    sec.questions.forEach(function(q,qi){
      qNum++;
      const focused=svFocusedQ===q.id;
      const isChoice=q.type==='radio'||q.type==='checkbox'||q.type==='dropdown';
      h+='<div class="sv-q-card'+(focused?' sv-q-focused':'')+'" data-qid="'+q.id+'" data-sv-click="focusQ" data-sv-qid="'+q.id+'">';
      if(!q.shortLabel)q.shortLabel='';
      h+='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
        +'<div style="display:flex;align-items:center;gap:4px"><span style="font-size:11px;font-weight:700;color:var(--cyan)">Q'+qNum+'</span>'
        +'<input class="sv-q-short-label" value="'+escHtml(q.shortLabel)+'" maxlength="30" placeholder="헤더명" data-sv-input="setShortLabel" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-click="stopProp"></div>'
        +'<select class="sv-q-type-select" data-sv-change="changeQType" data-sv-si="'+si+'" data-sv-qi="'+qi+'">';
      Object.keys(SV_QTYPES).forEach(function(k){h+='<option value="'+k+'"'+(k===q.type?' selected':'')+'>'+SV_QTYPES[k]+'</option>';});
      h+='</select></div>';
      h+='<input class="sv-q-title-input" value="'+escHtml(q.text)+'" data-sv-input="setQText" data-sv-si="'+si+'" data-sv-qi="'+qi+'" placeholder="질문을 입력하세요" style="flex:1">';
      /* 설명 + 서식 툴바 (클릭 시 표시) */
      h+='<div class="sv-desc-wrap" id="svDescWrap'+q.id+'">'
        +'<div class="sv-rich-toolbar" id="svDescToolbar'+q.id+'" style="display:none">'
        +'<select class="sv-rich-size" data-sv-change="execCmdVal" data-sv-cmd="fontName" title="글씨체">'
        +'<option value="Noto Sans KR" selected>본고딕 (Noto Sans KR)</option>'
        +'<option value="맑은 고딕, Malgun Gothic">맑은 고딕</option>'
        +'<option value="굴림, Gulim">굴림</option>'
        +'<option value="돋움, Dotum">돋움</option>'
        +'<option value="바탕, Batang">바탕</option>'
        +'<option value="Apple SD Gothic Neo">Apple SD 고딕</option>'
        +'<option value="SF Pro, -apple-system">SF Pro</option>'
        +'<option value="Roboto">Roboto</option>'
        +'<option value="Arial">Arial</option>'
        +'<option value="Georgia">Georgia</option>'
        +'<option value="Times New Roman">Times New Roman</option>'
        +'</select>'
        +'<select class="sv-rich-size" data-sv-change="setFontSize" title="글자 크기">'
        +'<option value="1">10px</option><option value="2">13px</option><option value="3" selected>16px</option><option value="4">18px</option><option value="5">24px</option><option value="6">32px</option><option value="7">48px</option>'
        +'</select>'
        +'<div class="sv-rich-sep"></div>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="bold" title="굵게"><b>B</b></button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="italic" title="기울임"><i>I</i></button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="underline" title="밑줄"><u>U</u></button>'
        +'<div class="sv-rich-sep"></div>'
        +'<button class="sv-rich-btn" data-sv-click="insertLink" title="URL/YouTube 링크 삽입">🔗</button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="insertOrderedList" title="번호 목록">1.</button>'
        +'<button class="sv-rich-btn" data-sv-click="execCmd" data-sv-cmd="insertUnorderedList" title="점 목록">•</button>'
        +'</div>'
        +'<div class="sv-q-desc-edit" id="svDescEdit'+q.id+'" contenteditable="true" data-si="'+si+'" data-qi="'+qi+'" style="min-height:16px;outline:none;font-size:12px;color:var(--t3);font-family:var(--f);line-height:1.6;border-bottom:1px solid transparent;padding:3px 0;transition:border-color .2s" data-sv-focus="showDescToolbar" data-sv-qid="'+q.id+'" data-sv-input="setQDesc" data-sv-si="'+si+'" data-sv-qi="'+qi+'">'+(q.desc||'<span style="color:var(--t3);opacity:0.5">설명 추가 (선택)</span>')+'</div>'
        +'</div>';
      /* 선택지 영역 */
      if(isChoice){
        const icon=q.type==='radio'?'○':q.type==='checkbox'?'☐':'▾';
        h+='<div style="margin-top:12px">';
        const _hasMultiLang=svWizardSelectedLangs.length>1;
        const _optLangMeta={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
        if(!q.optionTranslations)q.optionTranslations={};
        q.options.forEach(function(opt,oi){
          h+='<div class="sv-opt-row">'
            +'<span class="sv-opt-icon">'+icon+'</span>'
            +'<input class="sv-opt-input" value="'+escHtml(opt)+'" data-sv-input="setOption" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-oi="'+oi+'" placeholder="선택지 '+(oi+1)+'">';
          if(q.sectionJump){
            const jm=q.jumpMap||{};const jv=jm[oi]||'';
            h+='<select class="sv-rich-size" style="font-size:9px;max-width:100px" data-sv-change="setJumpMap" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-oi="'+oi+'"><option value=""'+(jv===''?' selected':'')+'>다음 섹션</option>';
            d.sections.forEach(function(s2,s2i){if(s2i!==si)h+='<option value="'+s2i+'"'+(jv===String(s2i)?' selected':'')+'>→ '+escHtml(s2.title)+'</option>';});
            h+='<option value="end"'+(jv==='end'?' selected':'')+'>설문 제출</option></select>';
          }
          h+='<span style="width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:8px;border:1px solid rgba(239,68,68,0.2);line-height:1;opacity:0;transition:opacity .12s" class="sv-opt-x" data-sv-click="deleteOption" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-oi="'+oi+'" data-sv-qid="'+q.id+'">✕</span></div>';
        });
        if(q.hasOther){
          h+='<div class="sv-opt-row"><span class="sv-opt-icon">'+icon+'</span><span style="font-size:12px;color:var(--t3);border-bottom:1px dashed var(--t3);padding-bottom:2px;flex:1">기타...</span>'
            +'<span style="width:14px;height:14px;border-radius:50%;background:rgba(239,68,68,0.1);color:#ef4444;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:8px;border:1px solid rgba(239,68,68,0.2);line-height:1;opacity:0;transition:opacity .12s" class="sv-opt-x" data-sv-click="removeOther" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-qid="'+q.id+'">✕</span></div>';
        }
        h+='<div class="sv-add-opt">'
          +'<span class="sv-opt-icon">'+icon+'</span>'
          +'<span data-sv-click="addOption" data-sv-si="'+si+'" data-sv-qi="'+qi+'" style="cursor:pointer;border-bottom:1px dashed var(--t3)">선택지 추가</span>';
        if(!q.hasOther)h+='<span style="margin-left:8px;color:var(--t3)">또는</span><span data-sv-click="addOther" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-qid="'+q.id+'" style="cursor:pointer;color:var(--cyan);margin-left:4px">\'기타\' 추가</span>';
        h+='</div>';
        /* 번역 넣기 아코디언 — 선택지 추가 아래 */
        if(_hasMultiLang){
          if(!q.translations)q.translations={};if(!q.optionTranslations)q.optionTranslations={};
          let _tlDone=0, _tlTotal=0;
          svWizardSelectedLangs.forEach(function(lc){if(lc==='ko')return;_tlTotal++;const _tv=q.translations[lc];const hasQ=_tv&&(typeof _tv==='string'?_tv.trim():(_tv.text&&_tv.text.trim()));const allOpt=q.options.every(function(_,oi2){return q.optionTranslations[oi2]&&q.optionTranslations[oi2][lc]&&q.optionTranslations[oi2][lc].trim();});if(hasQ&&allOpt)_tlDone++;});
          const _tlAllDone=_tlDone===_tlTotal&&_tlTotal>0;
          h+='<div style="margin-top:8px">'
            +'<div class="set-accordion" data-sv-click="toggleSecDescAcc" style="padding:8px 12px;font-size:11px">'
            +'<span style="display:flex;align-items:center;gap:6px">🌐 번역 넣기 <span id="svTransBadge_'+q.id+'" style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:'+(_tlAllDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)')+';color:'+(_tlAllDone?'var(--gs)':'var(--cyan)')+'">'+_tlDone+'/'+_tlTotal+'</span></span>'
            +'<span class="set-acc-arrow">▼</span></div>'
            +'<div class="set-accordion-body" id="svOptLangAcc_'+q.id+'">';
          svWizardSelectedLangs.forEach(function(lc){
            if(lc==='ko')return;
            const lm=_optLangMeta[lc]||{name:lc,flag:''};
            const _tvRaw=q.translations[lc]||'';
            const tv=typeof _tvRaw==='string'?_tvRaw:(_tvRaw.text||'');
            const hasQTrans=tv.trim().length>0;
            const allOptDone=q.options.every(function(_,oi2){return q.optionTranslations[oi2]&&q.optionTranslations[oi2][lc]&&q.optionTranslations[oi2][lc].trim();});
            const langDone=hasQTrans&&allOptDone;
            h+='<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bdrl)">'
              +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
              +'<span style="font-size:16px;line-height:1">'+lm.flag+'</span>'
              +'<span style="font-size:11px;font-weight:600;color:var(--t2)">'+lm.name+'</span>'
              +'<span id="svLangDot_'+q.id+'_'+lc+'" style="width:10px;height:10px;border-radius:50%;background:'+(langDone?'#22c55e':'#aaa')+';flex-shrink:0;transition:background .2s"></span>'
              +'<button class="sv-btn sv-btn-sm" data-sv-click="translatePrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px;margin-left:auto" title="프롬프트 미리보기 및 편집">🔍 프롬프트 미리보기</button>'
              +'<button class="sv-btn sv-btn-sm" data-sv-click="quickCopyPrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px" title="프롬프트를 바로 클립보드에 복사">📋 프롬프트 복사</button>'
              +'</div>';
            h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
              +'<span style="font-size:9px;color:var(--cyan);font-weight:700;min-width:28px">질문</span>'
              +'<span style="font-size:10px;color:var(--t3);min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">'+escHtml(q.text||'')+'</span>'
              +'<span style="color:var(--t3)">→</span>'
              +'<input class="sv-q-title-input sv-lang-input" data-qid="'+q.id+'" data-lang="'+lc+'" value="'+escHtml(tv)+'" data-sv-input="qTranslation" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" data-sv-qid="'+q.id+'" placeholder="'+lm.name+' 질문 번역" style="flex:1;font-size:11px;padding:4px 8px">'
              +'</div>';
            q.options.forEach(function(opt2,oi2){
              if(!q.optionTranslations[oi2])q.optionTranslations[oi2]={};
              const otv=q.optionTranslations[oi2][lc]||'';
              h+='<div style="display:flex;align-items:center;gap:6px;margin-top:3px">'
                +'<span style="font-size:9px;color:var(--t3);min-width:28px">보기'+(oi2+1)+'</span>'
                +'<span style="font-size:10px;color:var(--t3);min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">'+escHtml(opt2)+'</span>'
                +'<span style="color:var(--t3)">→</span>'
                +'<input class="sv-q-title-input" value="'+escHtml(otv)+'" data-sv-input="optTranslation" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-oi="'+oi2+'" data-sv-lc="'+lc+'" data-sv-qid="'+q.id+'" placeholder="'+lm.name+' 번역" style="flex:1;font-size:11px;padding:4px 8px">'
                +'</div>';
            });
            if(q.hasOther)h+='<div style="margin-top:4px;font-size:10px;color:var(--t3);padding-left:28px">💡 \'기타...\' 선택지는 자동 번역됩니다.</div>';
            /* 설명 번역 입력 칸 */
            if(q.desc){
              if(!q.descTranslations)q.descTranslations={};
              const dtv=q.descTranslations[lc]||'';
              h+='<div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--bdrl)">'
                +'<span style="font-size:9px;color:var(--t3);min-width:28px;padding-top:4px">설명</span>'
                +'<span style="color:var(--t3);padding-top:4px">→</span>'
                +'<textarea data-sv-input="qDescTrans" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" placeholder="'+lm.name+' 설명 번역" style="flex:1;font-size:10px;padding:4px 8px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--t1);font-family:var(--f);min-height:36px;resize:vertical;outline:none">'+escHtml(dtv)+'</textarea>'
                +'</div>';
            }
            h+='</div>';
          });
          h+='</div></div>';
        }
        h+='</div>';
      } else if(q.type==='short_text'||q.type==='date_text'||q.type==='time_text'){
        const ph=q.type==='short_text'?'단답형 텍스트':q.type==='date_text'?'YYYY-MM-DD':'HH:MM';
        h+='<div style="margin-top:12px;border-bottom:1px solid var(--bdr);padding-bottom:4px;max-width:50%;color:var(--t3);font-size:12px">'+ph+'</div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='paragraph'){
        h+='<div style="margin-top:12px;border-bottom:1px solid var(--bdr);padding-bottom:4px;color:var(--t3);font-size:12px">장문형 텍스트</div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='scale'){
        const labels=q.scaleLabels||['',''];
        h+='<div style="margin-top:12px"><div style="display:flex;gap:8px;margin-bottom:6px"><input class="sv-opt-input" value="'+escHtml(labels[0])+'" placeholder="최솟값 라벨" style="max-width:120px;border-bottom:1px solid var(--bdr)" data-sv-input="scaleLabel" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-idx="0">'
          +'<input class="sv-opt-input" value="'+escHtml(labels[1])+'" placeholder="최댓값 라벨" style="max-width:120px;border-bottom:1px solid var(--bdr)" data-sv-input="scaleLabel" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-idx="1"></div>';
        h+='<div class="sv-scale-row"><span class="sv-scale-label">'+escHtml(labels[0])+'</span>';
        (q.options||['1','2','3','4','5']).forEach(function(v){h+='<div class="sv-scale-dot">'+v+'</div>';});
        h+='<span class="sv-scale-label">'+escHtml(labels[1])+'</span></div></div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='star'){
        h+='<div style="margin-top:12px;display:flex;gap:4px">';
        for(let si2=0;si2<5;si2++)h+='<span style="font-size:24px;color:var(--yl);cursor:default">★</span>';
        h+='</div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='date_cal'){
        h+='<div style="margin-top:12px"><input type="date" class="form-input" disabled style="max-width:200px;font-size:11px"></div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='time_clock'){
        h+='<div style="margin-top:12px"><input type="time" class="form-input" disabled style="max-width:160px;font-size:11px"></div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildNonChoiceTransAcc(q,si,qi);
      } else if(q.type==='grid_radio'||q.type==='grid_text'){
        const rows=q.gridRows||['행 1','행 2'];const cols=q.gridCols||['열 1','열 2','열 3'];
        h+='<div style="margin-top:12px;overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%"><thead><tr><th></th>';
        cols.forEach(function(c,ci){h+='<th style="padding:4px 8px;text-align:center"><input class="sv-opt-input" value="'+escHtml(c)+'" style="text-align:center;max-width:80px" data-sv-input="setGridCol" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-ci="'+ci+'"></th>';});
        h+='<th><button class="sv-btn sv-btn-sm" data-sv-click="addGridCol" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-qid="'+q.id+'" data-sv-next="'+String(cols.length+1)+'">+</button></th></tr></thead><tbody>';
        rows.forEach(function(r,ri){
          h+='<tr><td style="padding:4px 8px;min-width:120px;white-space:normal;word-break:keep-all;overflow-wrap:break-word"><input class="sv-opt-input" value="'+escHtml(r)+'" data-sv-input="setGridRow" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-ri="'+ri+'" style="white-space:normal;word-break:keep-all"></td>';
          cols.forEach(function(){h+='<td style="text-align:center;padding:4px">'+(q.type==='grid_radio'?'○':'<input class="form-input" disabled style="width:50px;font-size:10px;padding:2px">')+'</td>';});
          h+='<td></td></tr>';
        });
        h+='</tbody></table><button class="sv-btn sv-btn-sm" style="margin-top:4px" data-sv-click="addGridRow" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-qid="'+q.id+'" data-sv-next="'+String(rows.length+1)+'">+ 행 추가</button></div>';
        if(svWizardSelectedLangs.length>1)h+=svBuildGridTransAcc(q,si,qi);
      }
      /* 하단 툴바 */
      h+='<div class="sv-q-toolbar">'
        +'<button class="sv-tool-btn" data-sv-click="duplicateQ" data-sv-si="'+si+'" data-sv-qi="'+qi+'" title="복제"><span style="position:relative;display:inline-block;width:14px;height:14px"><span style="position:absolute;top:0;left:0;width:10px;height:12px;border:1.5px solid currentColor;border-radius:2px"></span><span style="position:absolute;top:3px;left:3px;width:10px;height:12px;border:1.5px solid currentColor;border-radius:2px;background:var(--card)"></span></span></button>'
        +'<button class="sv-tool-btn danger" data-sv-click="deleteQ" data-sv-si="'+si+'" data-sv-qi="'+qi+'" title="삭제">🗑</button>'
        +'<div style="width:1px;height:20px;background:var(--bdr);margin:0 4px"></div>'
        +'<span style="font-size:10px;color:var(--t3);margin-right:4px">필수</span>'
        +'<div class="sv-toggle'+(q.required?' on':'')+'" data-sv-click="toggleRequired" data-sv-si="'+si+'" data-sv-qi="'+qi+'"></div>'
        +'<div style="width:1px;height:20px;background:var(--bdr);margin:0 4px"></div>'
        +'<button class="sv-tool-btn" data-sv-click="showQMenu" data-sv-si="'+si+'" data-sv-qi="'+qi+'" title="더보기" style="font-size:14px;letter-spacing:-2px">⋮</button>'
        +'</div>';
      h+='</div>';
    });
    h+='<div style="display:flex;gap:6px;margin-bottom:8px;margin-top:4px">'
      +'<button class="sv-btn sv-btn-sm" data-sv-click="addQuestion" data-sv-si="'+si+'">+ 문항 추가</button></div>';
    /* 섹션 하단: 이 섹션 후 이동 */
    if(d.sections.length>1){
      const afterVal=sec.afterSection||(si===d.sections.length-1?'end':'');
      h+='<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:16px;background:var(--bg2);border-radius:8px;border:1px solid var(--bdr)">'
        +'<span style="font-size:11px;color:var(--t3);font-weight:600;white-space:nowrap">이 섹션 후 →</span>'
        +'<select class="sv-rich-size" style="font-size:10px;flex:1" data-sv-change="setAfterSection" data-sv-si="'+si+'"><option value=""'+(afterVal===''?' selected':'')+'>다음 섹션으로 이동</option>';
      d.sections.forEach(function(s2,s2i){
        if(s2i!==si)h+='<option value="'+s2i+'"'+(afterVal===String(s2i)?' selected':'')+'>섹션 '+(s2i+1)+': '+escHtml(s2.title)+'</option>';
      });
      h+='<option value="end"'+(afterVal==='end'?' selected':'')+'>설문 제출</option></select></div>';
    }
  });
  h+='<div style="display:flex;gap:8px;margin-top:8px;margin-bottom:20px"><button class="sv-btn" data-sv-click="addSection">+ 섹션 추가</button></div>';
  h+='<div class="ec-autosave-msg">모든 내용이 자동으로 저장되어 창을 종료해도 상태가 유지됩니다.</div>';
  h+='</div>';
  el.innerHTML=h;
  /* 스크롤 복원 */
  const newWrap=document.getElementById('svEditorScroll');
  if(newWrap){
    if(scrollToQid){
      const target=newWrap.querySelector('[data-qid="'+scrollToQid+'"]');
      if(target)newWrap.scrollTop=target.offsetTop-newWrap.offsetTop-20;
      else newWrap.scrollTop=prevScroll;
    } else {newWrap.scrollTop=prevScroll;}
  }
  /* textarea auto-height */
  el.querySelectorAll('textarea.sv-section-desc-input').forEach(function(ta){
    ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';
    ta.addEventListener('input',function(){this.style.height='auto';this.style.height=this.scrollHeight+'px';});
  });
  /* 설명 contenteditable 초기화 */
  el.querySelectorAll('.sv-q-desc-edit').forEach(function(div){
    /* 플레이스홀더 span 클릭 시 제거 */
    div.addEventListener('focus',function(){
      const ph=this.querySelector('span[style*="opacity"]');
      if(ph&&this.children.length===1&&ph===this.firstChild)this.innerHTML='';
    });
    /* 포커스 해제 시 툴바 숨김 */
    div.addEventListener('blur',function(){
      const id=this.id.replace('svDescEdit','');
      const tb=document.getElementById('svDescToolbar'+id);
      setTimeout(function(){
        if(tb&&!tb.contains(document.activeElement))tb.style.display='none';
      },200);
    });
    /* 붙여넣기 시 스크립트 태그 등 위험 요소 제거 */
    div.addEventListener('paste',function(e){
      e.preventDefault();
      const html=e.clipboardData.getData('text/html');
      if(html){
        const tmp=document.createElement('div');tmp.innerHTML=html;
        tmp.querySelectorAll('script,iframe,object,embed,link,style,form').forEach(function(el){el.remove();});
        tmp.querySelectorAll('*').forEach(function(el){
          Array.from(el.attributes).forEach(function(a){if(a.name.startsWith('on'))el.removeAttribute(a.name);});
        });
        document.execCommand('insertHTML',false,tmp.innerHTML);
      } else {
        const text=e.clipboardData.getData('text/plain');
        document.execCommand('insertText',false,text);
      }
    });
  });
  /* ── data-sv-click 클릭 이벤트 위임 (translatePrompt/quickCopyPrompt) ── */
  el.querySelectorAll('[data-sv-click="translatePrompt"]').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopPropagation(); svOpenTranslatePrompt(parseInt(btn.dataset.svSi),parseInt(btn.dataset.svQi),btn.dataset.svLc); });
  });
  el.querySelectorAll('[data-sv-click="quickCopyPrompt"]').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopPropagation(); svQuickCopyPrompt(parseInt(btn.dataset.svSi),parseInt(btn.dataset.svQi),btn.dataset.svLc); });
  });
  /* ── data-sv-input 입력 이벤트 위임 ── */
  el.querySelectorAll('[data-sv-input="secDescTrans"]').forEach(function(ta){
    ta.addEventListener('input', function(){
      const si=parseInt(ta.dataset.svSi), lc=ta.dataset.svLc;
      if(!svSurveyData.sections[si].descTranslations)svSurveyData.sections[si].descTranslations={};
      svSurveyData.sections[si].descTranslations[lc]=ta.value;
      svUpdateSecDescDot(si,lc);
    });
  });
  el.querySelectorAll('[data-sv-input="qTranslation"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), lc=inp.dataset.svLc, qid=parseInt(inp.dataset.svQid);
      svSurveyData.sections[si].questions[qi].translations[lc]=inp.value;
      svUpdateTransDot(qid,si,qi,lc);
    });
  });
  el.querySelectorAll('[data-sv-input="optTranslation"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), oi=parseInt(inp.dataset.svOi), lc=inp.dataset.svLc, qid=parseInt(inp.dataset.svQid);
      if(!svSurveyData.sections[si].questions[qi].optionTranslations)svSurveyData.sections[si].questions[qi].optionTranslations={};
      if(!svSurveyData.sections[si].questions[qi].optionTranslations[oi])svSurveyData.sections[si].questions[qi].optionTranslations[oi]={};
      svSurveyData.sections[si].questions[qi].optionTranslations[oi][lc]=inp.value;
      svUpdateTransDot(qid,si,qi,lc);
    });
  });
  el.querySelectorAll('[data-sv-input="qDescTrans"]').forEach(function(ta){
    ta.addEventListener('input', function(){
      const si=parseInt(ta.dataset.svSi), qi=parseInt(ta.dataset.svQi), lc=ta.dataset.svLc;
      if(!svSurveyData.sections[si].questions[qi].descTranslations)svSurveyData.sections[si].questions[qi].descTranslations={};
      svSurveyData.sections[si].questions[qi].descTranslations[lc]=ta.value;
    });
  });
  el.querySelectorAll('[data-sv-input="scaleLabel"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), idx=parseInt(inp.dataset.svIdx);
      if(!svSurveyData.sections[si].questions[qi].scaleLabels)svSurveyData.sections[si].questions[qi].scaleLabels=['',''];
      svSurveyData.sections[si].questions[qi].scaleLabels[idx]=inp.value;
    });
  });
  el.querySelectorAll('[data-sv-input="qTranslationSimple"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), lc=inp.dataset.svLc;
      svSurveyData.sections[si].questions[qi].translations[lc]=inp.value;
    });
  });
  el.querySelectorAll('[data-sv-input="gridColTrans"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), ci=parseInt(inp.dataset.svCi), lc=inp.dataset.svLc;
      if(!svSurveyData.sections[si].questions[qi].gridColTranslations)svSurveyData.sections[si].questions[qi].gridColTranslations={};
      if(!svSurveyData.sections[si].questions[qi].gridColTranslations[ci])svSurveyData.sections[si].questions[qi].gridColTranslations[ci]={};
      svSurveyData.sections[si].questions[qi].gridColTranslations[ci][lc]=inp.value;
    });
  });
  el.querySelectorAll('[data-sv-input="gridRowTrans"]').forEach(function(inp){
    inp.addEventListener('input', function(){
      const si=parseInt(inp.dataset.svSi), qi=parseInt(inp.dataset.svQi), ri=parseInt(inp.dataset.svRi), lc=inp.dataset.svLc;
      if(!svSurveyData.sections[si].questions[qi].gridRowTranslations)svSurveyData.sections[si].questions[qi].gridRowTranslations={};
      if(!svSurveyData.sections[si].questions[qi].gridRowTranslations[ri])svSurveyData.sections[si].questions[qi].gridRowTranslations[ri]={};
      svSurveyData.sections[si].questions[qi].gridRowTranslations[ri][lc]=inp.value;
    });
  });
}
function svFocusQ(qid){svFocusedQ=qid;document.querySelectorAll('.sv-q-card').forEach(function(c){c.classList.toggle('sv-q-focused',parseInt(c.dataset.qid)===qid);});}
function svChangeQType(si,qi,newType){
  const q=_dmChangeQuestionType(svSurveyData,si,qi,newType);
  if(!q)return;
  svRenderQuestionEditor(q.id);
}
/* ── 번역 dot 업데이트 (질문+보기 모두 완료 시 초록) ── */
function svUpdateTransDot(qid,si,qi,lc){
  const q=svSurveyData.sections[si].questions[qi];
  const dot=document.getElementById('svLangDot_'+qid+'_'+lc);
  if(!dot)return;
  const _qtv=q.translations&&q.translations[lc];const hasQTrans=_qtv&&(typeof _qtv==='string'?_qtv.trim():(_qtv.text&&_qtv.text.trim()));
  const isChoice=q.type==='radio'||q.type==='checkbox'||q.type==='dropdown';
  let thisDone=false;
  if(isChoice&&q.options&&q.options.length>0){
    const allOptDone=q.options.every(function(_,oi){return q.optionTranslations&&q.optionTranslations[oi]&&q.optionTranslations[oi][lc]&&q.optionTranslations[oi][lc].trim();});
    thisDone=hasQTrans&&allOptDone;
  } else {
    thisDone=!!hasQTrans;
  }
  dot.style.background=thisDone?'#22c55e':'#aaa';
  /* 배지 업데이트 */
  const badge=document.getElementById('svTransBadge_'+qid);
  if(badge){
    let done=0, total=0;
    svWizardSelectedLangs.forEach(function(l){
      if(l==='ko')return;total++;
      const hq=q.translations&&q.translations[l]&&q.translations[l].trim();
      if(isChoice&&q.options&&q.options.length>0){
        const ao=q.options.every(function(_,oi2){return q.optionTranslations&&q.optionTranslations[oi2]&&q.optionTranslations[oi2][l]&&q.optionTranslations[oi2][l].trim();});
        if(hq&&ao)done++;
      } else {if(hq)done++;}
    });
    badge.textContent=done+'/'+total;
    const allDone=done===total&&total>0;
    badge.style.background=allDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)';
    badge.style.color=allDone?'var(--gs)':'var(--cyan)';
  }
}

/* ── 보기 없는 타입용 번역 넣기 아코디언 ── */
function svBuildNonChoiceTransAcc(q,si,qi){
  const _lm={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
  if(!q.translations)q.translations={};
  let _ncDone=0, _ncTotal=0;
  svWizardSelectedLangs.forEach(function(lc){if(lc==='ko')return;_ncTotal++;const _nv=q.translations[lc];if(_nv&&(typeof _nv==='string'?_nv.trim():(_nv.text&&_nv.text.trim())))_ncDone++;});
  const _ncAllDone=_ncDone===_ncTotal&&_ncTotal>0;
  let h='<div style="margin-top:8px">'
    +'<div class="set-accordion" data-sv-click="toggleSecDescAcc" style="padding:8px 12px;font-size:11px">'
    +'<span style="display:flex;align-items:center;gap:6px">🌐 번역 넣기 <span id="svTransBadge_'+q.id+'" style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:'+(_ncAllDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)')+';color:'+(_ncAllDone?'var(--gs)':'var(--cyan)')+'">'+_ncDone+'/'+_ncTotal+'</span></span>'
    +'<span class="set-acc-arrow">▼</span></div>'
    +'<div class="set-accordion-body" id="svOptLangAcc_'+q.id+'">';
  svWizardSelectedLangs.forEach(function(lc){
    if(lc==='ko')return;
    const lm=_lm[lc]||{name:lc,flag:''};
    const _tvr2=q.translations[lc]||'';
    const tv=typeof _tvr2==='string'?_tvr2:(_tvr2.text||'');
    const hasVal=tv.trim().length>0;
    h+='<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bdrl)">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
      +'<span style="font-size:16px;line-height:1">'+lm.flag+'</span>'
      +'<span style="font-size:11px;font-weight:600;color:var(--t2)">'+lm.name+'</span>'
      +'<span id="svLangDot_'+q.id+'_'+lc+'" style="width:10px;height:10px;border-radius:50%;background:'+(hasVal?'#22c55e':'#aaa')+';flex-shrink:0;transition:background .2s"></span>'
      +'<button class="sv-btn sv-btn-sm" data-sv-click="translatePrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px;margin-left:auto" title="프롬프트 미리보기 및 편집">🔍 프롬프트 미리보기</button>'
      +'<button class="sv-btn sv-btn-sm" data-sv-click="quickCopyPrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px" title="프롬프트를 바로 클립보드에 복사">📋 프롬프트 복사</button>'
      +'</div>';
    h+='<div style="display:flex;align-items:center;gap:6px">'
      +'<span style="font-size:9px;color:var(--cyan);font-weight:700;min-width:28px">질문</span>'
      +'<span style="font-size:10px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">'+escHtml(q.text||'')+'</span>'
      +'<span style="color:var(--t3)">→</span>'
      +'<input class="sv-q-title-input sv-lang-input" data-qid="'+q.id+'" data-lang="'+lc+'" value="'+escHtml(tv)+'" data-sv-input="qTranslation" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" data-sv-qid="'+q.id+'" placeholder="'+lm.name+' 질문 번역" style="flex:1;font-size:11px;padding:4px 8px">'
      +'</div>';
    /* 설명 번역 입력 칸 (non-choice) */
    if(q.desc){
      if(!q.descTranslations)q.descTranslations={};
      const dtv2=q.descTranslations[lc]||'';
      h+='<div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--bdrl)">'
        +'<span style="font-size:9px;color:var(--t3);min-width:28px;padding-top:4px">설명</span>'
        +'<span style="color:var(--t3);padding-top:4px">→</span>'
        +'<textarea data-sv-input="qDescTrans" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" placeholder="'+lm.name+' 설명 번역" style="flex:1;font-size:10px;padding:4px 8px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--t1);font-family:var(--f);min-height:36px;resize:vertical;outline:none">'+escHtml(dtv2)+'</textarea>'
        +'</div>';
    }
    h+='</div>';
  });
  h+='</div></div>';
  return h;
}

/* ── 그리드 문항용 번역 넣기 아코디언 (행/열 번역 포함) ── */
function svBuildGridTransAcc(q,si,qi){
  const _lm={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
  if(!q.translations)q.translations={};
  if(!q.gridRowTranslations)q.gridRowTranslations={};
  if(!q.gridColTranslations)q.gridColTranslations={};
  const rows=q.gridRows||[];const cols=q.gridCols||[];
  /* 완료 상태: 질문번역 + 모든행 + 모든열 다 있어야 done */
  let _gDone=0, _gTotal=0;
  svWizardSelectedLangs.forEach(function(lc){
    if(lc==='ko')return;_gTotal++;
    const _nv=q.translations[lc];const hq=_nv&&(typeof _nv==='string'?_nv.trim():(_nv.text&&_nv.text.trim()));
    const allRows=rows.every(function(_,ri){return q.gridRowTranslations[ri]&&q.gridRowTranslations[ri][lc]&&q.gridRowTranslations[ri][lc].trim();});
    const allCols=cols.every(function(_,ci){return q.gridColTranslations[ci]&&q.gridColTranslations[ci][lc]&&q.gridColTranslations[ci][lc].trim();});
    if(hq&&allRows&&allCols)_gDone++;
  });
  const _gAllDone=_gDone===_gTotal&&_gTotal>0;
  let h='<div style="margin-top:8px">'
    +'<div class="set-accordion" data-sv-click="toggleSecDescAcc" style="padding:8px 12px;font-size:11px">'
    +'<span style="display:flex;align-items:center;gap:6px">🌐 번역 넣기 <span id="svTransBadge_'+q.id+'" style="font-size:9px;font-weight:600;padding:1px 6px;border-radius:4px;background:'+(_gAllDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)')+';color:'+(_gAllDone?'var(--gs)':'var(--cyan)')+'">'+_gDone+'/'+_gTotal+'</span></span>'
    +'<span class="set-acc-arrow">▼</span></div>'
    +'<div class="set-accordion-body" id="svOptLangAcc_'+q.id+'">';
  svWizardSelectedLangs.forEach(function(lc){
    if(lc==='ko')return;
    const lm=_lm[lc]||{name:lc,flag:''};
    const _tvr=q.translations[lc]||'';
    const tv=typeof _tvr==='string'?_tvr:(_tvr.text||'');
    const hasVal=tv.trim().length>0;
    h+='<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bdrl)">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">'
      +'<span style="font-size:16px;line-height:1">'+lm.flag+'</span>'
      +'<span style="font-size:11px;font-weight:600;color:var(--t2)">'+lm.name+'</span>'
      +'<span style="width:10px;height:10px;border-radius:50%;background:'+(hasVal?'#22c55e':'#aaa')+';flex-shrink:0;transition:background .2s"></span>'
      +'<button class="sv-btn sv-btn-sm" data-sv-click="translatePrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px;margin-left:auto" title="프롬프트 미리보기 및 편집">🔍 프롬프트 미리보기</button>'
      +'<button class="sv-btn sv-btn-sm" data-sv-click="quickCopyPrompt" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" style="font-size:10px;white-space:nowrap;padding:3px 8px" title="프롬프트를 바로 클립보드에 복사">📋 프롬프트 복사</button>'
      +'</div>';
    /* 질문 번역 */
    h+='<div style="display:flex;align-items:center;gap:6px">'
      +'<span style="font-size:9px;color:var(--cyan);font-weight:700;min-width:28px">질문</span>'
      +'<span style="font-size:10px;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px">'+escHtml(q.text||'')+'</span>'
      +'<span style="color:var(--t3)">→</span>'
      +'<input class="sv-q-title-input sv-lang-input" value="'+escHtml(tv)+'" data-sv-input="qTranslationSimple" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" placeholder="'+lm.name+' 질문 번역" style="flex:1;font-size:11px;padding:4px 8px">'
      +'</div>';
    /* 설명 번역 */
    if(q.desc){
      if(!q.descTranslations)q.descTranslations={};
      const dtv=q.descTranslations[lc]||'';
      h+='<div style="display:flex;align-items:flex-start;gap:6px;margin-top:6px;padding-top:6px;border-top:1px dashed var(--bdrl)">'
        +'<span style="font-size:9px;color:var(--t3);min-width:28px;padding-top:4px">설명</span>'
        +'<span style="color:var(--t3);padding-top:4px">→</span>'
        +'<textarea data-sv-input="qDescTrans" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-lc="'+lc+'" placeholder="'+lm.name+' 설명 번역" style="flex:1;font-size:10px;padding:4px 8px;border:1px solid var(--bdr);border-radius:4px;background:transparent;color:var(--t1);font-family:var(--f);min-height:36px;resize:vertical;outline:none">'+escHtml(dtv)+'</textarea>'
        +'</div>';
    }
    /* 열(column) 번역: 해당 없음, 완치, 치료 중 등 */
    if(cols.length>0){
      h+='<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--bdrl)">'
        +'<div style="font-size:9px;color:var(--cyan);font-weight:700;margin-bottom:6px">열 (응답 항목)</div>';
      cols.forEach(function(c,ci){
        if(!q.gridColTranslations[ci])q.gridColTranslations[ci]={};
        const ctv=q.gridColTranslations[ci][lc]||'';
        h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
          +'<span style="font-size:9px;color:var(--t3);min-width:28px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(c)+'">'+escHtml(c)+'</span>'
          +'<span style="color:var(--t3)">→</span>'
          +'<input class="sv-q-title-input sv-lang-input" value="'+escHtml(ctv)+'" data-sv-input="gridColTrans" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-ci="'+ci+'" data-sv-lc="'+lc+'" placeholder="'+escHtml(c)+' → '+lm.name+'" style="flex:1;font-size:10px;padding:3px 6px">'
          +'</div>';
      });
      h+='</div>';
    }
    /* 행(row) 번역: 알레르기성 피부염, 아토피 피부염 등 */
    if(rows.length>0){
      h+='<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--bdrl)">'
        +'<div style="font-size:9px;color:var(--cyan);font-weight:700;margin-bottom:6px">행 (질환/항목)</div>';
      rows.forEach(function(r,ri){
        if(!q.gridRowTranslations[ri])q.gridRowTranslations[ri]={};
        const rtv=q.gridRowTranslations[ri][lc]||'';
        h+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
          +'<span style="font-size:9px;color:var(--t3);min-width:28px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+escHtml(r)+'">'+escHtml(r)+'</span>'
          +'<span style="color:var(--t3)">→</span>'
          +'<input class="sv-q-title-input sv-lang-input" value="'+escHtml(rtv)+'" data-sv-input="gridRowTrans" data-sv-si="'+si+'" data-sv-qi="'+qi+'" data-sv-ri="'+ri+'" data-sv-lc="'+lc+'" placeholder="'+escHtml(r)+' → '+lm.name+'" style="flex:1;font-size:10px;padding:3px 6px">'
          +'</div>';
      });
      h+='</div>';
    }
    h+='</div>';
  });
  h+='</div></div>';
  return h;
}

function svGetTranslatePrompt(langCode){
  return _trGetQuestionPrompt(langCode);
}

/* ── 질문+보기 통합 프롬프트 텍스트 생성 ── */
function _svBuildQText(q){
  return _trBuildQuestionText(q);
}

function svQuickCopyPrompt(si,qi,langCode){
  const q=svSurveyData.sections[si].questions[qi];
  const prompt=svGetTranslatePrompt(langCode);
  const fullText=prompt+_svBuildQText(q);
  navigator.clipboard.writeText(fullText).then(function(){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='클립보드에 복사되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
  }).catch(function(err){console.error('[ERROR] clipboard.writeText',err);});
}
function svOpenTranslatePrompt(si,qi,langCode){
  const q=svSurveyData.sections[si].questions[qi];
  const langMeta={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
  const lm=langMeta[langCode]||{name:langCode,flag:''};
  const prompt=svGetTranslatePrompt(langCode);
  const qText=_svBuildQText(q);
  const ov=document.createElement('div');
  ov.id='svTranslateOverlay';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  let html='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:90vw;max-width:900px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3)">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--bdr)">'
    +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">'+lm.flag+'</span><span style="font-size:14px;font-weight:700;color:var(--t1)">'+lm.name+' 번역 프롬프트</span></div>'
    +'<button style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer" data-sv-click="closeTranslateOverlay">✕</button>'
    +'</div>';
  html+='<div style="display:flex;flex:1;min-height:0;overflow:hidden">';
  html+='<div style="flex:1;display:flex;flex-direction:column;border-right:1px solid var(--bdr);padding:16px;min-height:0">'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px;flex-shrink:0">AI 프롬프트 (수정 가능)</label>'
    +'<textarea id="svTransPromptText" style="flex:1;width:100%;min-height:80px;border:1px solid var(--bdr);border-radius:8px;padding:10px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg2);resize:none;line-height:1.6;box-sizing:border-box" data-sv-input="transUpdatePreview">'+escHtml(prompt)+'</textarea>'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-top:10px;margin-bottom:4px;flex-shrink:0">'+_FLAG_KO+' 한국어 질문 + 보기 (수정 가능)</label>'
    +'<div style="font-size:10px;color:var(--t1);margin-bottom:6px;flex-shrink:0">※ 여기서 수정한 내용은 클립보드 복사에만 반영됩니다. 문항 자체를 수정하려면 설문 편집 화면에서 직접 수정하세요.</div>'
    +'<textarea id="svTransKoreanText" style="flex:1;width:100%;min-height:60px;border:1px solid var(--bdr);border-radius:8px;padding:10px;font-size:13px;font-family:var(--f);color:var(--t1);background:var(--bg2);resize:none;line-height:1.6;box-sizing:border-box" data-sv-input="transUpdatePreview">'+escHtml(qText)+'</textarea>'
    +'</div>';
  html+='<div style="flex:1;display:flex;flex-direction:column;padding:16px;min-height:0">'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px;flex-shrink:0">클립보드에 복사될 내용 미리보기</label>'
    +'<div id="svTransPreview" style="flex:1;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg2);line-height:1.7;white-space:pre-wrap;overflow-y:auto;min-height:0"></div>'
    +'</div>';
  html+='</div>';
  html+='<div style="display:flex;justify-content:center;gap:10px;padding:14px 20px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 12px 12px">'
    +'<button class="sv-btn-primary" style="padding:10px 24px;font-size:13px" data-sv-click="transCopyAndClose">📋 클립보드에 복사</button>'
    +'</div>';
  html+='</div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  svTransUpdatePreview();
}
function svTransUpdatePreview(){
  const pv=document.getElementById('svTransPreview');
  const pt=document.getElementById('svTransPromptText');
  const kt=document.getElementById('svTransKoreanText');
  if(pv&&pt&&kt)pv.textContent=_trBuildPreviewText(pt.value,kt.value);
}
function svTransCopyAndClose(){
  const pt=document.getElementById('svTransPromptText');
  const kt=document.getElementById('svTransKoreanText');
  if(pt&&kt){
    const fullText=_trBuildPreviewText(pt.value,kt.value);
    navigator.clipboard.writeText(fullText).then(function(){
      const ov=document.getElementById('svTranslateOverlay');
      if(ov)closeModalGracefully(ov);
      const toast=document.getElementById('globalSaveToast');
      if(toast){toast.textContent='클립보드에 복사되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
    }).catch(function(err){console.error('[ERROR] clipboard.writeText',err);});
  }
}

/* ── 섹션 설명 번역 아코디언 토글 ── */
function svToggleSecDescAcc(el){
  _uiToggleAccordionState(el);
}
function svUpdateSecDescDot(si,lc){
  const dot=document.getElementById('svSecDescDot_'+si+'_'+lc);
  const sec=svSurveyData.sections[si];
  if(dot)dot.style.background=(sec.descTranslations&&sec.descTranslations[lc]&&sec.descTranslations[lc].trim())?'#22c55e':'#aaa';
  /* 배지 업데이트 */
  const badge=document.getElementById('svSecDescBadge_'+si);
  if(badge&&sec.descTranslations){
    let done=0, total=0;
    svWizardSelectedLangs.forEach(function(l){if(l==='ko')return;total++;if(sec.descTranslations[l]&&sec.descTranslations[l].trim())done++;});
    badge.textContent=done+'/'+total;
    const allDone=done===total&&total>0;
    badge.style.background=allDone?'rgba(34,197,94,0.15)':'rgba(6,182,212,0.12)';
    badge.style.color=allDone?'var(--gs)':'var(--cyan)';
  }
}

/* ── 섹션 설명 번역 프롬프트 ── */
function _svGetDescPrompt(langCode){
  return _trGetDescriptionPrompt(langCode);
}
function svSecDescCopyPrompt(si,langCode){
  const sec=svSurveyData.sections[si];
  const prompt=_svGetDescPrompt(langCode);
  const fullText=prompt+(sec.desc||'');
  navigator.clipboard.writeText(fullText).then(function(){
    const toast=document.getElementById('globalSaveToast');
    if(toast){toast.textContent='클립보드에 복사되었습니다.';toast.className='global-save-toast show';setTimeout(function(){toast.className='global-save-toast';},2500);}
  }).catch(function(err){console.error('[ERROR] clipboard.writeText',err);});
}
function svSecDescOpenPrompt(si,langCode){
  const sec=svSurveyData.sections[si];
  const langMeta={en:{name:'영어',flag:'🇺🇸'},ru:{name:'러시아어',flag:'🇷🇺'},vi:{name:'베트남어',flag:'🇻🇳'},km:{name:'캄보디아어',flag:_FLAG_KM},th:{name:'태국어',flag:'🇹🇭'},tl:{name:'필리핀어',flag:'🇵🇭'},zh:{name:'중국어',flag:_FLAG_CN},ja:{name:'일본어',flag:'🇯🇵'},mn:{name:'몽골어',flag:_FLAG_MN},ne:{name:'네팔어',flag:'🇳🇵'},id:{name:'인도네시아어',flag:'🇮🇩'},ar:{name:'아랍어',flag:_FLAG_SA},ur:{name:'우르두어',flag:'🇵🇰'},es:{name:'스페인어',flag:_FLAG_ES}};
  const lm=langMeta[langCode]||{name:langCode,flag:''};
  const prompt=_svGetDescPrompt(langCode);
  const descText=sec.desc||'';
  const ov=document.createElement('div');
  ov.id='svTranslateOverlay';
  ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  let html='<div style="background:var(--card);border:1px solid var(--bdr);border-radius:12px;width:90vw;max-width:900px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3)">';
  html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--bdr)">'
    +'<div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px">'+lm.flag+'</span><span style="font-size:14px;font-weight:700;color:var(--t1)">'+lm.name+' 설명 번역 프롬프트</span></div>'
    +'<button style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer" data-sv-click="closeTranslateOverlay">✕</button>'
    +'</div>';
  html+='<div style="display:flex;flex:1;min-height:0;overflow:hidden">';
  html+='<div style="flex:1;display:flex;flex-direction:column;border-right:1px solid var(--bdr);padding:16px;min-height:0">'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px;flex-shrink:0">AI 프롬프트 (수정 가능)</label>'
    +'<textarea id="svTransPromptText" style="flex:1;width:100%;min-height:80px;border:1px solid var(--bdr);border-radius:8px;padding:10px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg2);resize:none;line-height:1.6;box-sizing:border-box" data-sv-input="transUpdatePreview">'+escHtml(prompt)+'</textarea>'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-top:10px;margin-bottom:4px;flex-shrink:0">'+_FLAG_KO+' 한국어 설명 (수정 가능)</label>'
    +'<div style="font-size:10px;color:var(--t1);margin-bottom:6px;flex-shrink:0">※ 여기서 수정한 내용은 클립보드 복사에만 반영됩니다. 섹션 설명을 수정하려면 설문 편집 화면에서 직접 수정하세요.</div>'
    +'<textarea id="svTransKoreanText" style="flex:1;width:100%;min-height:60px;border:1px solid var(--bdr);border-radius:8px;padding:10px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg2);resize:none;line-height:1.6;box-sizing:border-box" data-sv-input="transUpdatePreview">'+escHtml(descText)+'</textarea>'
    +'</div>';
  html+='<div style="flex:1;display:flex;flex-direction:column;padding:16px;min-height:0">'
    +'<label style="font-size:11px;font-weight:700;color:var(--t1);margin-bottom:6px;flex-shrink:0">클립보드에 복사될 내용 미리보기</label>'
    +'<div id="svTransPreview" style="flex:1;border:1px solid var(--bdr);border-radius:8px;padding:12px;font-size:12px;font-family:var(--f);color:var(--t1);background:var(--bg2);line-height:1.7;white-space:pre-wrap;overflow-y:auto;min-height:0"></div>'
    +'</div>';
  html+='</div>';
  html+='<div style="display:flex;justify-content:center;gap:10px;padding:14px 20px;border-top:1px solid var(--bdr);background:var(--bg2);border-radius:0 0 12px 12px">'
    +'<button class="sv-btn-primary" style="padding:10px 24px;font-size:13px" data-sv-click="transCopyAndClose">📋 클립보드에 복사</button>'
    +'</div>';
  html+='</div>';
  ov.innerHTML=html;
  ov.addEventListener('click',function(e){if(e.target===ov)closeModalGracefully(ov);});
  document.body.appendChild(ov);
  svTransUpdatePreview();
}

function svAddOption(si,qi){
  const q=svSurveyData.sections[si].questions[qi];
  const newIdx=_dmAddOption(svSurveyData,si,qi);
  svRenderQuestionEditor(q.id);
  /* 새 선택지에 포커스 + 선택 */
  setTimeout(function(){
    const wrap=document.getElementById('svEditorScroll');if(!wrap)return;
    const card=wrap.querySelector('[data-qid="'+q.id+'"]');if(!card)return;
    const inputs=card.querySelectorAll('.sv-opt-input');
    const last=inputs[inputs.length-1];
    if(last){last.focus();last.placeholder='선택지 '+(newIdx+1);}
  },50);
}
function svSetFontSize(val){document.execCommand('fontSize',false,val);}
function svInsertLink(){
  let url=prompt('URL을 입력하세요:');
  if(!url)return;
  if(!/^https?:\/\//i.test(url))url='https://'+url;
  /* YouTube 임베드 감지 */
  const ytMatch=url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  if(ytMatch){
    document.execCommand('insertHTML',false,'<div style="margin:8px 0"><iframe width="400" height="225" src="https://www.youtube.com/embed/'+ytMatch[1]+'" frameborder="0" allowfullscreen style="border-radius:8px;max-width:100%"></iframe></div>');
  } else {
    const text=document.getSelection().toString()||url;
    document.execCommand('insertHTML',false,'<a href="'+url+'" target="_blank" style="color:var(--cyan);text-decoration:underline">'+escHtml(text)+'</a>');
  }
}
function svShowQMenu(si,qi,btn){
  const existing=document.getElementById('svQMenuPopup');if(existing)existing.remove();
  const rect=btn.getBoundingClientRect();
  const popup=document.createElement('div');popup.id='svQMenuPopup';
  popup.style.cssText='position:fixed;top:'+(rect.bottom+4)+'px;left:'+(rect.left-180)+'px;width:220px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;box-shadow:var(--sh);z-index:500;overflow:hidden';
  popup.innerHTML='<div style="padding:6px 0">'
    +'<div style="padding:8px 14px;font-size:11px;color:var(--t2);cursor:pointer;transition:background .1s" data-sv-click="toggleSectionJump" data-sv-si="'+si+'" data-sv-qi="'+qi+'" class="sv-qmenu-item">↗ 답변에 따라 섹션을 이동 '+(svSurveyData.sections[si].questions[qi].sectionJump?'✓':'')+'</div>'
    +'<div style="padding:8px 14px;font-size:11px;color:var(--t2);cursor:pointer;transition:background .1s" data-sv-click="shuffleOptions" data-sv-si="'+si+'" data-sv-qi="'+qi+'" class="sv-qmenu-item">🔀 옵션 순서 무작위로 섞기</div>'
    +'<div style="border-top:1px solid var(--bdr);margin:4px 0"></div>'
    +'<div style="padding:8px 14px;font-size:11px;color:var(--t2);cursor:pointer;transition:background .1s" data-sv-click="splitSection" data-sv-si="'+si+'" data-sv-qi="'+qi+'" class="sv-qmenu-item">✂ 섹션 나누기 (바로 아래부터)</div>'
    +'</div>';
  document.body.appendChild(popup);
  setTimeout(function(){document.addEventListener('click',function handler(e){if(!popup.contains(e.target)){popup.remove();document.removeEventListener('click',handler);}});},0);
}
function svToggleSectionJump(si,qi){
  const q=_dmToggleSectionJump(svSurveyData,si,qi);
  if(!q)return;
  svRenderQuestionEditor(q.id);
}
function svShuffleOptions(si,qi){
  if(!_dmShuffleOptions(svSurveyData,si,qi))return;
  svRenderQuestionEditor();
}
function svSplitSection(si,qi){
  if(!_dmSplitSection(svSurveyData,si,qi))return;
  svRenderQuestionEditor();
}

function svAddQuestion(si){
  _dmAddQuestion(svSurveyData,si);
  svRenderQuestionEditor();
}
function svAddSection(){
  _dmAddSection(svSurveyData);
  svRenderQuestionEditor();
}
function svDeleteQ(si,qi){
  _dmDeleteQuestion(svSurveyData,si,qi);
  svRenderQuestionEditor();
}
function svDuplicateQ(si,qi){
  _dmDuplicateQuestion(svSurveyData,si,qi);
  svRenderQuestionEditor();
}
const _svPeriodTrans={
  ko:function(s,e,t){return '응답 기간: '+s+' ~ '+e+(t?' '+t+' 까지':'');},
  en:function(s,e,t){return 'Response period: '+s+' ~ '+e+(t?' until '+t:'');},
  ru:function(s,e,t){return 'Период ответа: '+s+' ~ '+e+(t?' до '+t:'');},
  vi:function(s,e,t){return 'Thời gian trả lời: '+s+' ~ '+e+(t?' đến '+t:'');},
  km:function(s,e,t){return 'រយៈពេលឆ្លើយតប: '+s+' ~ '+e+(t?' ដល់ '+t:'');},
  th:function(s,e,t){return 'ระยะเวลาตอบ: '+s+' ~ '+e+(t?' ถึง '+t:'');},
  tl:function(s,e,t){return 'Panahon ng pagsagot: '+s+' ~ '+e+(t?' hanggang '+t:'');},
  zh:function(s,e,t){return '作答期间: '+s+' ~ '+e+(t?' 截止 '+t:'');},
  ja:function(s,e,t){return '回答期間: '+s+' ~ '+e+(t?' '+t+' まで':'');}
};
const _svPreviewLangNames={ko:'한국어',en:'English',ru:'Русский',vi:'Tiếng Việt',km:'ភាសាខ្មែរ',th:'ภาษาไทย',tl:'Filipino',zh:'中文',ja:'日本語',mn:'Монгол',ne:'नेपाली',id:'Bahasa Indonesia',ar:'العربية',ur:'اردو',es:'Español'};
const _svPreviewFlags={ko:_FLAG_KO,en:'🇺🇸',ru:'🇷🇺',vi:'🇻🇳',km:_FLAG_KM,th:'🇹🇭',tl:'🇵🇭',zh:_FLAG_CN,ja:'🇯🇵',mn:_FLAG_MN,ne:'🇳🇵',id:'🇮🇩',ar:_FLAG_SA,ur:'🇵🇰',es:_FLAG_ES};
const _svPreviewI18n={
  select:{ko:'선택하세요',en:'Select',ru:'Выберите',vi:'Chọn',km:'ជ្រើសរើស',th:'เลือก',tl:'Pumili',zh:'请选择',ja:'選択してください'},
  input:{ko:'응답을 입력하세요',en:'Enter your response',ru:'Введите ответ',vi:'Nhập câu trả lời',km:'បញ្ចូលចម្លើយ',th:'กรอกคำตอบ',tl:'Ilagay ang sagot',zh:'请输入回答',ja:'回答を入力してください'},
  other:{ko:'기타:',en:'Other:',ru:'Другое:',vi:'Khác:',km:'ផ្សេងទៀត:',th:'อื่นๆ:',tl:'Iba pa:',zh:'其他:',ja:'その他:'},
  submit:{ko:'제출',en:'Submit',ru:'Отправить',vi:'Gửi',km:'ដាក់ស្នើ',th:'ส่ง',tl:'Isumite',zh:'提交',ja:'送信'},
  nextSec:{ko:'다음 섹션으로 →',en:'Next section →',ru:'Следующий раздел →',vi:'Phần tiếp theo →',km:'ផ្នែកបន្ទាប់ →',th:'ส่วนถัดไป →',tl:'Susunod na seksyon →',zh:'下一部分 →',ja:'次のセクションへ →'},
  langQ:{ko:'어떤 언어로 응답하시겠습니까?',en:'Which language would you like to respond in?',ru:'На каком языке вы хотите отвечать?',vi:'Bạn muốn trả lời bằng ngôn ngữ nào?',km:'តើអ្នកចង់ឆ្លើយតបជាភាសាអ្វី?',th:'คุณต้องการตอบเป็นภาษาอะไร?',tl:'Anong wika ang gusto mong sagutin?',zh:'请问您希望使用哪种语言作答？',ja:'どの言語で回答されますか？'},
  childQ:{ko:'우리 학교에 다니고 있는 귀하의 자녀가 몇 명인가요?',en:'How many of your children attend our school?',ru:'Сколько ваших детей учатся в нашей школе?',vi:'Bạn có bao nhiêu con đang học tại trường chúng tôi?',km:'តើកូនរបស់អ្នកប៉ុន្មាននាក់រៀននៅសាលារបស់យើង?',th:'บุตรหลานของท่านกี่คนที่เรียนอยู่ที่โรงเรียนของเรา?',tl:'Ilang anak mo ang nag-aaral sa aming paaralan?',zh:'请问您有几个孩子在本校就读？',ja:'お子さまは何名本校に通われていますか？'},
  childOpt:{ko:'{n}명',en:'{n} child(ren)',ru:'{n} ребёнок/детей',vi:'{n} con',km:'កូន {n} នាក់',th:'{n} คน',tl:'{n} anak',zh:'{n}名',ja:'{n}名'}
};
function _svBuildPreviewBody(lc){
  const d=svSurveyData;let qNum=0;const isKo=lc==='ko';
  const startD=d.startDate||'', endD=d.endDate||'', endT=(d.hasEndTime&&d.endTime)?d.endTime:'';
  const pfn=_svPeriodTrans[lc]||_svPeriodTrans.ko;
  const i18n=function(key){return (_svPreviewI18n[key]&&_svPreviewI18n[key][lc])||_svPreviewI18n[key].ko;};
  let h='<div style="max-width:640px;margin:0 auto;padding:20px">';
  /* 제목 + 기간 */
  h+='<div style="border-left:4px solid var(--cyan);padding:16px;margin-bottom:20px;background:var(--card);border-radius:0 9px 9px 0;border:1px solid var(--bdr);border-left:4px solid var(--cyan)">'
    +'<div style="font-size:18px;font-weight:800;color:var(--t1);margin-bottom:6px">'+escHtml(d.title)+'</div>'
    +'<div style="font-size:11px;color:var(--t2);line-height:1.6">'+escHtml(pfn(startD,endD,endT))+'</div></div>';
  /* 자동 문항: 언어 선택 */
  const allLangs=svWizardSelectedLangs&&svWizardSelectedLangs.length?svWizardSelectedLangs:['ko'];
  if(allLangs.length>1){
    qNum++;
    h+='<div class="sv-question-card" style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:6px">Q'+qNum+'. '+escHtml(i18n('langQ'))+' <span style="color:var(--rs)">*</span></div>';
    allLangs.forEach(function(l){
      h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="radio" name="svpq_lang" style="margin-right:6px">'+(_svPreviewFlags[l]||'')+' '+escHtml(_svPreviewLangNames[l]||l)+'</label></div>';
    });
    h+='</div>';
  }
  /* 자동 문항: 자녀 수 */
  qNum++;
  h+='<div class="sv-question-card" style="margin-bottom:10px"><div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:6px">Q'+qNum+'. '+escHtml(i18n('childQ'))+' <span style="color:var(--rs)">*</span></div>';
  for(let n=1;n<=5;n++){
    h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="radio" name="svpq_child" style="margin-right:6px">'+escHtml(i18n('childOpt').replace('{n}',n))+'</label></div>';
  }
  h+='</div>';
  /* 섹션/문항 */
  const totalSec=d.sections.length;
  d.sections.forEach(function(sec,si){
    const isLastSec=(si===totalSec-1);
    const secTitle=(!isKo&&sec.titleTranslations&&sec.titleTranslations[lc])?sec.titleTranslations[lc]:sec.title;
    h+='<div style="font-size:11px;font-weight:700;color:var(--cyan);margin:12px 0 6px;padding-left:8px;border-left:3px solid var(--cyan);word-break:keep-all;overflow-wrap:break-word">'+escHtml(secTitle)+'</div>';
    if(sec.desc){
      const secDesc=(!isKo&&sec.descTranslations&&sec.descTranslations[lc])?sec.descTranslations[lc]:sec.desc;
      h+='<div style="font-size:10px;color:var(--t2);margin-bottom:8px;padding:8px 10px;background:var(--bg2);border-radius:6px;border:1px solid var(--bdrl);white-space:pre-wrap;line-height:1.5">'+escHtml(secDesc)+'</div>';
    }
    sec.questions.forEach(function(q){
      qNum++;
      const _qtr=(!isKo&&q.translations&&q.translations[lc])?q.translations[lc]:null;
      const qText=_qtr?(typeof _qtr==='string'?_qtr:(_qtr.text||q.text)):q.text;
      h+='<div class="sv-question-card" style="margin-bottom:8px"><div style="font-size:10.5px;font-weight:600;color:var(--t1);margin-bottom:4px;word-break:keep-all;overflow-wrap:break-word">Q'+qNum+'. '+escHtml(qText)+(q.required?' <span style="color:var(--rs)">*</span>':'')+'</div>';
      if(q.desc){const descText=(!isKo&&q.descTranslations&&q.descTranslations[lc])?q.descTranslations[lc]:q.desc;h+='<div style="font-size:10px;color:var(--t3);margin-bottom:4px;white-space:pre-wrap">'+escHtml(descText).replace(/&lt;br&gt;/g,'<br>')+'</div>';}
      function getOpt(o,oi){if(!isKo&&q.optionTranslations&&q.optionTranslations[oi]&&q.optionTranslations[oi][lc])return q.optionTranslations[oi][lc];if(!isKo&&_qtr&&typeof _qtr==='object'&&_qtr.options&&_qtr.options[oi])return _qtr.options[oi];return o;}
      if(q.type==='radio'){(q.options||[]).forEach(function(o,oi){h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="radio" name="svpq'+q.id+'" style="margin-right:6px">'+escHtml(getOpt(o,oi))+'</label></div>';});if(q.hasOther)h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="radio" name="svpq'+q.id+'" style="margin-right:6px">'+escHtml(i18n('other'))+' <input style="border:none;border-bottom:1px solid var(--bdr);background:transparent;font-size:11px;width:150px;padding:2px 4px;outline:none;color:var(--t1)"></label></div>';}
      else if(q.type==='checkbox'){(q.options||[]).forEach(function(o,oi){h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="checkbox" style="margin-right:6px">'+escHtml(getOpt(o,oi))+'</label></div>';});if(q.hasOther)h+='<div class="sv-option-item"><label style="cursor:pointer"><input type="checkbox" style="margin-right:6px">'+escHtml(i18n('other'))+' <input style="border:none;border-bottom:1px solid var(--bdr);background:transparent;font-size:11px;width:150px;padding:2px 4px;outline:none;color:var(--t1)"></label></div>';}
      else if(q.type==='dropdown'){h+='<select class="form-input" style="max-width:300px;font-size:11px"><option value="">'+escHtml(i18n('select'))+'</option>';(q.options||[]).forEach(function(o,oi){h+='<option>'+escHtml(getOpt(o,oi))+'</option>';});h+='</select>';}
      else if(q.type==='short_text'||q.type==='date_text'||q.type==='time_text')h+='<input style="width:100%;max-width:400px;border:none;border-bottom:1px solid var(--bdr);background:transparent;font-size:11px;padding:6px 2px;outline:none;color:var(--t1);font-family:var(--f);transition:border-color .15s" placeholder="'+(q.type==='date_text'?'YYYY-MM-DD':q.type==='time_text'?'HH:MM':escHtml(i18n('input')))+'">';
      else if(q.type==='paragraph')h+='<textarea style="width:100%;max-width:500px;border:none;border-bottom:1px solid var(--bdr);background:transparent;font-size:11px;padding:6px 2px;outline:none;color:var(--t1);font-family:var(--f);resize:none;height:60px;transition:border-color .15s" placeholder="'+escHtml(i18n('input'))+'"></textarea>';
      else if(q.type==='scale'){const labels=q.scaleLabels||['',''];h+='<div style="display:flex;align-items:center;gap:10px;padding:8px 0"><span style="font-size:10px;color:var(--t3)">'+escHtml(labels[0])+'</span>';(q.options||['1','2','3','4','5']).forEach(function(v){h+='<label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px"><input type="radio" name="svpq'+q.id+'"><span style="font-size:11px;font-weight:600">'+v+'</span></label>';});h+='<span style="font-size:10px;color:var(--t3)">'+escHtml(labels[1])+'</span></div>';}
      else if(q.type==='star')h+='<div style="display:flex;gap:4px;font-size:24px;color:var(--yl);cursor:pointer">★★★★★</div>';
      else if(q.type==='date_cal')h+='<input type="date" class="form-input" style="max-width:200px;font-size:11px">';
      else if(q.type==='time_clock')h+='<input type="time" class="form-input" style="max-width:160px;font-size:11px">';
      else if(q.type==='grid_radio'||q.type==='grid_text'){const rows=q.gridRows||[];const cols=q.gridCols||[];const _gtr=(!isKo&&_qtr&&typeof _qtr==='object')?_qtr:null;h+='<table style="border-collapse:collapse;font-size:11px;width:100%"><thead><tr><th></th>';cols.forEach(function(c,ci){const ct=(!isKo&&q.gridColTranslations&&q.gridColTranslations[ci]&&q.gridColTranslations[ci][lc])?q.gridColTranslations[ci][lc]:(_gtr&&_gtr.gridCols&&_gtr.gridCols[ci])?_gtr.gridCols[ci]:c;h+='<th style="padding:4px 8px;text-align:center">'+escHtml(ct)+'</th>';});h+='</tr></thead><tbody>';rows.forEach(function(r,ri){const rt=(!isKo&&q.gridRowTranslations&&q.gridRowTranslations[ri]&&q.gridRowTranslations[ri][lc])?q.gridRowTranslations[ri][lc]:(_gtr&&_gtr.gridRows&&_gtr.gridRows[ri])?_gtr.gridRows[ri]:r;h+='<tr><td style="padding:4px 8px;font-weight:600;min-width:100px;white-space:normal;word-break:keep-all;overflow-wrap:break-word">'+escHtml(rt)+'</td>';cols.forEach(function(){h+='<td style="text-align:center;padding:4px">'+(q.type==='grid_radio'?'<input type="radio">':'<input class="form-input" style="width:60px;font-size:10px;padding:2px">')+'</td>';});h+='</tr>';});h+='</tbody></table>';}
      h+='</div>';
    });
    if(isLastSec){
      h+='<div style="text-align:center;margin:16px 0 8px"><button class="sv-btn-primary" style="padding:10px 32px;font-size:13px;pointer-events:none;opacity:0.85">'+escHtml(i18n('submit'))+'</button></div>';
    } else {
      h+='<div style="text-align:right;margin:12px 0 8px"><button class="sv-btn" style="padding:8px 20px;font-size:12px;pointer-events:none;opacity:0.7">'+escHtml(i18n('nextSec'))+'</button></div>';
    }
  });
  h+='</div>';
  return h;
}
function svPreviewSurvey(){
  if(!svSurveyData)return;
  const langs=svWizardSelectedLangs&&svWizardSelectedLangs.length?svWizardSelectedLangs:['ko'];
  let langBtns='';
  if(langs.length>1){
    langBtns='<div style="display:flex;gap:6px;justify-content:center;padding:10px 20px 0">';
    langs.forEach(function(lc,i){
      const active=i===0;
      langBtns+='<button class="svp-lang-btn'+(active?' active':'')+'" data-lang="'+lc+'" style="display:flex;align-items:center;gap:5px;padding:6px 14px;border-radius:20px;border:1.5px solid '+(active?'var(--cyan)':'var(--bdr)')+';background:'+(active?'rgba(6,182,212,0.12)':'transparent')+';color:'+(active?'var(--cyan)':'var(--t3)')+';font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;font-family:var(--f)"><span style="font-size:16px;line-height:1">'+(_svPreviewFlags[lc]||'')+'</span>'+escHtml(_svPreviewLangNames[lc]||lc)+'</button>';
    });
    langBtns+='</div>';
  }
  const h=_svBuildPreviewBody(langs[0]);
  const ov=document.createElement('div');ov.className='sv-modal-overlay';ov.id='svPreviewOverlay';
  ov.innerHTML='<div style="background:var(--bg);border-radius:12px;width:95vw;max-width:700px;max-height:90vh;padding:0;box-shadow:0 20px 60px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--bdr);background:var(--popup-head);border-radius:12px 12px 0 0;flex-shrink:0"><span style="font-size:14px;font-weight:800;color:var(--t1)">📋 설문 미리보기</span><button style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer" data-sv-click="closePreviewOverlay">✕</button></div>'
    +langBtns
    +'<div id="svPreviewBody" style="flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#60a5fa transparent">'+h+'</div>'
    +'<div style="flex-shrink:0;border-top:1px solid var(--bdr);padding:12px 20px;background:var(--bg2);border-radius:0 0 12px 12px;display:flex;justify-content:center"><button class="sv-btn-primary" style="padding:10px 28px;font-size:13px" data-sv-click="closePreviewAndFinish">🚀 설문 생성 완료, QR &amp; URL 링크 생성</button></div>'
    +'</div>';
  ov.addEventListener('click',function(e){if(e.target===ov)_closeSvOverlay(ov);});
  document.body.appendChild(ov);
  requestAnimationFrame(function(){requestAnimationFrame(function(){ov.classList.add('show-anim');});});
  /* 언어 버튼 클릭 핸들러 */
  ov.querySelectorAll('.svp-lang-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      ov.querySelectorAll('.svp-lang-btn').forEach(function(b){b.style.borderColor='var(--bdr)';b.style.background='transparent';b.style.color='var(--t3)';b.classList.remove('active');});
      this.style.borderColor='var(--cyan)';this.style.background='rgba(6,182,212,0.12)';this.style.color='var(--cyan)';this.classList.add('active');
      const body=document.getElementById('svPreviewBody');
      if(body)body.innerHTML=_svBuildPreviewBody(this.dataset.lang);
    });
  });
}

function _svDownloadQR(fmt){
  const c=document.getElementById('svQrCanvas');if(!c)return;
  const link=document.createElement('a');
  link.download='survey-qr.'+(fmt==='jpeg'?'jpg':'png');
  link.href=c.toDataURL('image/'+fmt,0.95);
  link.click();
}
function svRenderComplete(){
  const el=document.getElementById('sv-wizard-step-5');if(!el)return;
  const title=svSurveyData?svSurveyData.title:'설문';
  const demoId='sv_'+Date.now().toString(36);
  const demoUrl='https://relay.example.com/survey/'+demoId;
  let h='<div style="text-align:center;padding:24px 20px 16px"><div style="font-size:44px;margin-bottom:10px">✅</div>'
    +'<div style="font-size:20px;font-weight:800;color:var(--t1);margin-bottom:4px">설문이 생성되었습니다!</div>'
    +'<div style="font-size:12px;color:var(--t3)">'+escHtml(title)+'</div></div>';
  h+='<div style="display:flex;gap:16px;padding:0 16px 20px;align-items:flex-start">';
  /* 왼쪽: QR & URL */
  h+='<div style="flex:1;min-width:0">'
    +'<div class="cc" style="padding:16px;margin-bottom:12px">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px;display:flex;align-items:center;gap:6px">🔗 설문 URL</div>'
    +'<div style="display:flex;gap:6px;margin-bottom:4px"><input class="form-input" id="svResultUrl" value="'+escHtml(demoUrl)+'" readonly style="flex:1;font-size:11px;font-family:var(--fm)">'
    +'<button class="sv-btn" data-sv-click="copyResultUrl" style="white-space:nowrap">📋 복사</button></div>'
    +'<div style="font-size:10px;color:var(--t3)">⚠️ 서버 연결 전 데모 URL입니다. 서버 구축 후 실제 URL이 생성됩니다.</div></div>'
    +'<div class="cc" style="padding:16px;text-align:center">'
    +'<div style="font-size:13px;font-weight:700;color:var(--t1);margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:6px">📱 QR 코드</div>'
    +'<canvas id="svQrCanvas" style="margin:0 auto 12px;display:block;border-radius:6px;image-rendering:pixelated"></canvas>'
    +'<div style="display:flex;gap:6px;justify-content:center">'
    +'<button class="sv-btn sv-btn-sm" data-sv-click="downloadQR" data-sv-fmt="png">📥 PNG 다운로드</button>'
    +'<button class="sv-btn sv-btn-sm" data-sv-click="downloadQR" data-sv-fmt="jpeg">📥 JPEG 다운로드</button></div>'
    +'</div></div>';
  /* 오른쪽: 가정통신문 */
  h+='<div style="flex:1;min-width:0">'
    +'<div class="cc" style="padding:20px;height:100%;display:flex;flex-direction:column;justify-content:center">'
    +'<div style="font-size:36px;text-align:center;margin-bottom:12px">📄</div>'
    +'<div style="font-size:14px;font-weight:700;color:var(--t1);text-align:center;margin-bottom:6px">가정통신문을 생성하시겠습니까?</div>'
    +'<div style="font-size:11px;color:var(--t3);text-align:center;margin-bottom:20px;line-height:1.6">설문 URL과 QR 코드를 포함한<br>가정통신문을 자동으로 만들 수 있습니다.</div>'
    +'<div style="display:flex;flex-direction:column;gap:8px;align-items:stretch">'
    +'<button class="sv-btn-primary" data-sv-click="openNewsletterModal" style="padding:10px 16px;font-size:12px;text-align:center">예, 지금 만들겠습니다.</button>'
    +'<button class="sv-btn" data-sv-click="openPanel" data-sv-panel="home\" style="padding:10px 16px;font-size:12px;text-align:center;justify-content:center">아니오, 나중에 만들겠습니다.</button>'
    +'</div></div></div>';
  h+='</div>';
  /* 하단: 홈으로 돌아가기 */
  h+='<div style="text-align:center;padding:0 16px 20px"><button class="sv-btn" data-sv-click="openPanel" data-sv-panel="home\" style="font-size:11px;color:var(--t3)">← 설문 홈으로 돌아가기</button></div>';
  el.innerHTML=h;
}

/* ── 현재 통계 뷰의 설문 컨텍스트 ── */
let _svStatsContext = { formId: '', year: '', title: '' };

function svRenderStats(params){
  const el=document.getElementById('sv-stats');if(!el)return;
  params=params||{};

  /* 설문 제목/ID 결정 */
  let title='설문 통계';
  let formId='';
  if(params.formId){ formId=params.formId; }
  else if(params.surveyType){
    const tplMatch=SV_TEMPLATES.filter(function(t){return t.type===params.surveyType;})[0];
    if(tplMatch){title=tplMatch.title;formId='tpl_'+params.surveyType;}
  } else if(typeof params.customIdx==='number'&&S.svCustomSurveys[params.customIdx]){
    const cv=S.svCustomSurveys[params.customIdx];
    title=cv.title||title;formId=cv.id||'custom_'+params.customIdx;
  } else if(params.title){
    title=params.title;formId=params.formId||'survey_'+encodeURIComponent(params.title).slice(0,32);
  }
  const year=params.year||String(new Date().getFullYear());
  _svStatsContext={formId:formId,year:year,title:title};

  /* 기본 구조 렌더링 (비동기 데이터 로드 전 스켈레톤) */
  let h='<button class="sv-back-btn" data-sv-click="openPanel" data-sv-panel="home\">← 설문 홈으로</button>';
  h+='<div class="sv-breadcrumb" style="margin-top:8px">설문 &gt; <span>'+escHtml(title)+'</span> &gt; 통계 ('+year+')</div>';

  /* 응답 가져오기 버튼 */
  h+='<div style="display:flex;gap:8px;align-items:center;margin:12px 0;padding:10px 14px;background:var(--card);border:1px solid var(--bdr);border-radius:8px">'
    +'<span style="font-size:12px;font-weight:700;color:var(--t1);flex:1">📥 응답 데이터 가져오기</span>'
    +'<button class="btn btn-primary btn-sm" data-sv-click="importResponseFile" style="font-size:11px">JSON 파일 선택</button>'
    +'</div>';

  h+='<div id="sv-stats-summary" style="margin-bottom:12px"><div style="padding:20px;text-align:center;color:var(--t3);font-size:12px">데이터 로딩 중...</div></div>';
  h+='<div id="sv-stats-resp-list"></div>';
  el.innerHTML=h;

  /* DB에서 응답 목록 비동기 로드 */
  if(formId && window.electronAPI && window.electronAPI.surveyResponseGetByForm){
    window.electronAPI.surveyResponseGetByForm(year, formId).then(function(res){
      _svRenderStatsSummary(res&&res.success?res.data:[]);
    }).catch(function(){ _svRenderStatsSummary([]); });
  } else {
    _svRenderStatsSummary([]);
  }
}

/** DB 응답 데이터로 통계 요약 렌더링 */
function _svRenderStatsSummary(rows){
  const summaryEl=document.getElementById('sv-stats-summary');
  const listEl=document.getElementById('sv-stats-resp-list');
  if(!summaryEl)return;

  const stuList=S.people.filter(function(s){return s.type==='student';});
  const total=stuList.length;
  const responded=rows.length;
  const rate=total?Math.round(responded/total*1000)/10:0;
  const notResp=Math.max(0,total-responded);

  /* 응답률 카드 */
  const h='<div class="cc" style="padding:14px;margin-bottom:12px"><div style="display:flex;align-items:center;gap:16px">'
    +'<div style="position:relative;width:70px;height:70px;flex-shrink:0">'
    +'<svg viewBox="0 0 36 36" style="width:70px;height:70px;transform:rotate(-90deg)">'
    +'<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bg2)" stroke-width="3.5"/>'
    +'<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cyan)" stroke-width="3.5" stroke-dasharray="'+rate+' '+(100-rate)+'" stroke-linecap="round" style="transition:stroke-dasharray .6s ease"/>'
    +'</svg>'
    +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--cyan)">'+rate+'%</div></div>'
    +'<div style="flex:1;min-width:0">'
    +'<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px">'+escHtml(_svStatsContext.title)+'</div>'
    +'<div style="display:flex;gap:12px;font-size:11px;color:var(--t2)">'
    +'<span>대상 <b style="color:var(--t1)">'+total+'</b>명</span>'
    +'<span>완료 <b style="color:var(--gs)">'+responded+'</b>명</span>'
    +'<span>미응답 <b style="color:var(--rs)">'+notResp+'</b>명</span></div>'
    +'</div></div></div>';
  summaryEl.innerHTML=h;

  if(!listEl)return;
  if(!rows.length){
    listEl.innerHTML='<div style="padding:16px;text-align:center;color:var(--t3);font-size:12px">아직 가져온 응답이 없습니다.<br>위의 <b>JSON 파일 선택</b> 버튼으로 응답을 가져오세요.</div>';
    return;
  }

  /* 응답자 목록 */
  let lh='<div class="sv-section-title">응답자 목록 ('+responded+'명)</div>';
  lh+='<div class="cc" style="padding:10px;overflow-x:auto"><table class="rec-table"><thead><tr>'
    +'<th>학년</th><th>반</th><th>번호</th><th>이름</th><th>응답일시</th><th></th></tr></thead><tbody>';
  rows.forEach(function(r){
    lh+='<tr>'
      +'<td>'+(r.grade||'')+'</td>'
      +'<td>'+(r.class_num||'')+'</td>'
      +'<td>'+(r.student_num||'')+'</td>'
      +'<td>'+escHtml(r.student_name||'')+'</td>'
      +'<td style="font-size:10px;color:var(--t3)">'+(r.responded_at||'').slice(0,16).replace('T',' ')+'</td>'
      +'<td><button class="sv-btn sv-btn-sm" data-sv-click="deleteResponse" data-sv-id="'+r.id+'" title="삭제" style="color:var(--rs);border-color:var(--rs)">✕</button></td>'
      +'</tr>';
  });
  lh+='</tbody></table></div>';
  listEl.innerHTML=lh;
}

/** JSON 파일 선택 → 응답 일괄 가져오기 */
function svImportResponseFile(){
  if(!(window.electronAPI&&window.electronAPI.surveyResponseImportBatch)){
    alert('가져오기 기능을 사용할 수 없습니다.'); return;
  }
  const ctx=_svStatsContext;
  if(!ctx.formId){alert('먼저 통계를 볼 설문을 선택하세요.'); return;}

  const inp=document.createElement('input');
  inp.type='file'; inp.accept='.json';
  inp.addEventListener('change', function(){
    const file=inp.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=function(e){
      let data;
      try{ data=JSON.parse(e.target.result); }
      catch(err){ alert('JSON 파싱 실패: '+err.message); return; }
      /* 단일 객체 → 배열로 정규화 */
      const arr=Array.isArray(data)?data:[data];
      if(!arr.length){ alert('응답 데이터가 없습니다.'); return; }
      window.electronAPI.surveyResponseImportBatch(ctx.year, ctx.formId, arr)
        .then(function(res){
          if(!res||!res.success){ alert('가져오기 실패: '+(res&&res.error||'알 수 없는 오류')); return; }
          bus.emit('toast:show', {text: res.count+'건의 응답을 가져왔습니다.'});
          /* 통계 뷰 갱신 */
          window.electronAPI.surveyResponseGetByForm(ctx.year,ctx.formId).then(function(r){
            _svRenderStatsSummary(r&&r.success?r.data:[]);
          }).catch(function(){});
        })
        .catch(function(err){ alert('가져오기 오류: '+err.message); });
    };
    reader.readAsText(file,'utf-8');
  });
  inp.click();
}

/** 단일 응답 삭제 */
function svDeleteResponse(id){
  if(!confirm('이 응답을 삭제하시겠습니까?'))return;
  if(!(window.electronAPI&&window.electronAPI.surveyResponseDelete))return;
  window.electronAPI.surveyResponseDelete(id).then(function(res){
    if(!res||!res.success){ alert('삭제 실패: '+(res&&res.error||'')); return; }
    const ctx=_svStatsContext;
    window.electronAPI.surveyResponseGetByForm(ctx.year,ctx.formId).then(function(r){
      _svRenderStatsSummary(r&&r.success?r.data:[]);
    }).catch(function(){});
  }).catch(function(err){console.error('[ERROR] surveyResponseDelete',err);});
}




function svShowReminderModal(grade,cls){
  const ctx=_svStatsContext;
  const user=S._userProfile||{};
  const position=user.position||'보건교사';
  const userName=user.name||S.settings.nurse1||'';
  if(window.electronAPI&&window.electronAPI.surveyResponseMissingMessage&&ctx.formId){
    window.electronAPI.surveyResponseMissingMessage(ctx.year,ctx.formId,grade,cls,position,userName).then(function(res){
      if(res&&res.success&&res.data){
        _svShowReminderUI(grade,cls,res.data.missing||[],res.data.message||'');
      }
    }).catch(function(){});
    return;
  }
}

function _svShowReminderUI(grade,cls,missing,msg){
  const ov=document.createElement('div');ov.className='sv-modal-overlay';ov.id='svReminderOverlay';
  ov.innerHTML='<div class="sv-modal"><div class="sv-modal-header"><span style="font-size:14px;font-weight:800;color:var(--t1)">📋 미응답 학생 안내 메시지</span>'
    +'<button style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer" data-sv-click="closeReminderOverlay">✕</button></div>'
    +'<div class="sv-modal-body"><div style="font-size:11px;color:var(--t3);margin-bottom:8px">'+grade+'학년 '+cls+'반 · 미응답 '+missing.length+'명</div>'
    +'<textarea id="svReminderText" readonly style="width:100%;height:220px;font-size:12px;color:var(--t1);background:var(--bg2);border:1px solid var(--bdr);border-radius:8px;padding:12px;resize:none;font-family:var(--f);line-height:1.7;box-sizing:border-box">'+msg.replace(/</g,'&lt;')+'</textarea>'
    +'<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">'
    +'<button class="sv-btn" data-sv-click="toggleReminderEdit">✏️ 수정</button>'
    +'<button class="sv-btn-primary" data-sv-click="copyReminderText">📋 클립보드에 복사</button>'
    +'<button class="sv-btn" data-sv-click="closeReminderOverlay">닫기</button></div></div></div>';
  ov.addEventListener('click',function(e){if(e.target===ov)_closeSvOverlay(ov);});
  document.body.appendChild(ov);
  requestAnimationFrame(function(){requestAnimationFrame(function(){ov.classList.add('show-anim');});});
}

export function svCopyToClipboard(text){
  navigator.clipboard.writeText(text).then(function(){bus.emit('toast:blue', {text: '클립보드에 복사되었습니다.'});}).catch(function(){
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);bus.emit('toast:blue', {text: '클립보드에 복사되었습니다.'});
  });
}

function svRenderNewsletter(){
  const el=document.getElementById('sv-newsletter');if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:40px;color:var(--t3);font-size:12px">가정통신문은 설문 생성 완료 후 팝업으로 제작할 수 있습니다.</div>';
}

  /* --- functions --- */

  /* ═══ 전역 이벤트 위임: data-sv-action 클릭 처리 ═══
   * innerHTML로 삽입된 onclick 속성이 CSP/Electron에서 차단될 수 있으므로
   * document 레벨 이벤트 위임으로 처리합니다. */
  /* ═══ data-sv-action 클릭 위임 ═══ */
  document.addEventListener('click', function(e){
    const t = e.target.closest('[data-sv-action]');
    if(!t) return;
    const action = t.dataset.svAction;
    if(action === 'openPanel'){
      const panel = t.dataset.svPanel || 'home';
      let params = {};
      try { params = JSON.parse(t.dataset.svParams || '{}'); } catch(_){}
      svOpenPanel(panel, params);
    }
  });

  /* ═══ data-sv-click 종합 클릭 위임 ═══ */
  document.addEventListener('click', function(e){
    const t = e.target.closest('[data-sv-click]');
    if(!t) return;
    const a = t.dataset.svClick;
    const si = t.dataset.svSi !== undefined ? parseInt(t.dataset.svSi) : undefined;
    const qi = t.dataset.svQi !== undefined ? parseInt(t.dataset.svQi) : undefined;
    switch(a){
      case 'stopProp': e.stopPropagation(); break;
      case 'openPanel': svOpenPanel(t.dataset.svPanel||'home'); break;
      case 'wizardStep': svWizardStep(parseInt(t.dataset.svStep)); break;
      case 'goStep2': svGoStep2(); break;
      case 'toggleStudent': svToggleStudent(parseInt(t.dataset.svSid), t); break;
      case 'focusQ': svFocusQ(parseInt(t.dataset.svQid)); break;
      case 'previewSurvey': svPreviewSurvey(); break;
      case 'toggleEndTime': {
        if(!svSurveyData) break;
        svSurveyData.hasEndTime = !svSurveyData.hasEndTime;
        t.classList.toggle('on', svSurveyData.hasEndTime);
        const wrap = document.getElementById('svEndTimeWrap');
        if(wrap) wrap.style.display = svSurveyData.hasEndTime ? 'flex' : 'none';
        break;
      }
      case 'openCal': {
        const field = document.getElementById(t.dataset.svField);
        if(field) field.showPicker ? field.showPicker() : field.focus();
        break;
      }
      case 'openClockPicker': {
        const field = document.getElementById(t.dataset.svField);
        if(field) openClockPicker(field);
        break;
      }
      case 'execCmd': document.execCommand(t.dataset.svCmd, false, null); break;
      case 'insertLink': svInsertLink(); break;
      case 'toggleSecDescAcc': svToggleSecDescAcc(t); break;
      case 'secDescCopyPrompt': svSecDescCopyPrompt(si, t.dataset.svLc); break;
      case 'secDescOpenPrompt': svSecDescOpenPrompt(si, t.dataset.svLc); break;
      case 'deleteSection': {
        if(!svSurveyData || !svSurveyData.sections[si]) break;
        if(!confirm('이 섹션을 삭제할까요?')) break;
        svSurveyData.sections.splice(si, 1);
        svRenderQuestionEditor();
        break;
      }
      case 'addOption': svAddOption(si, qi); break;
      case 'addOther': {
        const q = svSurveyData.sections[si].questions[qi];
        if(q) { q.hasOther = true; svRenderQuestionEditor(q.id); }
        break;
      }
      case 'removeOther': {
        const q2 = svSurveyData.sections[si].questions[qi];
        if(q2) { q2.hasOther = false; svRenderQuestionEditor(q2.id); }
        break;
      }
      case 'deleteOption': {
        const oi = parseInt(t.dataset.svOi);
        const q3 = svSurveyData.sections[si].questions[qi];
        if(q3 && q3.options) { q3.options.splice(oi, 1); svRenderQuestionEditor(q3.id); }
        break;
      }
      case 'addQuestion': svAddQuestion(si); break;
      case 'addSection': svAddSection(); break;
      case 'deleteQ': svDeleteQ(si, qi); break;
      case 'duplicateQ': svDuplicateQ(si, qi); break;
      case 'toggleRequired': {
        const q4 = svSurveyData.sections[si].questions[qi];
        if(q4) { q4.required = !q4.required; t.classList.toggle('on', q4.required); }
        break;
      }
      case 'showQMenu': svShowQMenu(si, qi, t); break;
      case 'toggleSectionJump': svToggleSectionJump(si, qi); break;
      case 'shuffleOptions': svShuffleOptions(si, qi); break;
      case 'splitSection': svSplitSection(si, qi); break;
      case 'translatePrompt': e.stopPropagation(); svOpenTranslatePrompt(si, qi, t.dataset.svLc); break;
      case 'quickCopyPrompt': e.stopPropagation(); svQuickCopyPrompt(si, qi, t.dataset.svLc); break;
      case 'closeTranslateOverlay': {
        const ov = t.closest('.sv-modal-overlay') || document.getElementById('svTranslateOverlay') || document.getElementById('svSecDescTransOverlay');
        if(ov) closeModalGracefully(ov);
        break;
      }
      case 'transCopyAndClose': svTransCopyAndClose(); break;
      case 'closePreviewOverlay': {
        const pov = document.getElementById('svPreviewOverlay');
        if(pov) _closeSvOverlay(pov);
        break;
      }
      case 'closePreviewAndFinish': {
        const pov2 = document.getElementById('svPreviewOverlay');
        if(pov2) _closeSvOverlay(pov2);
        svWizardStep(5);
        break;
      }
      case 'copyResultUrl': {
        const inp = document.getElementById('svResultUrl');
        if(inp) svCopyToClipboard(inp.value);
        break;
      }
      case 'downloadQR': _svDownloadQR(t.dataset.svFmt || 'png'); break;
      case 'openNewsletterModal': {
        bus.emit('toast:show', {text: '가정통신문 기능은 준비 중입니다.'});
        break;
      }
      case 'importResponseFile': svImportResponseFile(); break;
      case 'deleteResponse': svDeleteResponse(parseInt(t.dataset.svId)); break;
      case 'showReminderModal': svShowReminderModal(t.dataset.svGrade, t.dataset.svCls); break;
      case 'closeReminderOverlay': {
        const rov = document.getElementById('svReminderOverlay');
        if(rov) _closeSvOverlay(rov);
        break;
      }
      case 'toggleReminderEdit': {
        const ta = document.getElementById('svReminderText');
        if(ta) { ta.readOnly = !ta.readOnly; ta.style.background = ta.readOnly ? 'var(--bg2)' : 'var(--card)'; if(!ta.readOnly) ta.focus(); }
        break;
      }
      case 'copyReminderText': {
        const ta2 = document.getElementById('svReminderText');
        if(ta2) svCopyToClipboard(ta2.value);
        break;
      }
      case 'addGridCol': {
        const q5 = svSurveyData.sections[si].questions[qi];
        if(q5 && q5.gridCols) { q5.gridCols.push('열 ' + t.dataset.svNext); svRenderQuestionEditor(q5.id); }
        break;
      }
      case 'addGridRow': {
        const q6 = svSurveyData.sections[si].questions[qi];
        if(q6 && q6.gridRows) { q6.gridRows.push('행 ' + t.dataset.svNext); svRenderQuestionEditor(q6.id); }
        break;
      }
      case 'toggleLang': /* already handled via direct addEventListener */ break;
    }
  });

  /* ═══ data-sv-change 종합 change 위임 ═══ */
  document.addEventListener('change', function(e){
    const t = e.target.closest('[data-sv-change]');
    if(!t) return;
    const a = t.dataset.svChange;
    const si = t.dataset.svSi !== undefined ? parseInt(t.dataset.svSi) : undefined;
    const qi = t.dataset.svQi !== undefined ? parseInt(t.dataset.svQi) : undefined;
    switch(a){
      case 'toggleAllGrades': svToggleAllGrades(t); break;
      case 'updateGradeSelection': svUpdateGradeSelection(); break;
      case 'changeQType': svChangeQType(si, qi, t.value); break;
      case 'execCmdVal': document.execCommand(t.dataset.svCmd, false, t.value); break;
      case 'setFontSize': svSetFontSize(t.value); break;
      case 'setJumpMap': {
        const oi = parseInt(t.dataset.svOi);
        const q = svSurveyData.sections[si].questions[qi];
        if(q) { if(!q.jumpMap) q.jumpMap = {}; q.jumpMap[oi] = t.value; }
        break;
      }
      case 'setAfterSection': {
        const sec = svSurveyData.sections[si];
        if(sec) sec.afterSection = t.value;
        break;
      }
    }
  });

  /* ═══ data-sv-input 종합 input 위임 (step-4 바깥 요소용) ═══ */
  document.addEventListener('input', function(e){
    const t = e.target.closest('[data-sv-input]');
    if(!t) return;
    const a = t.dataset.svInput;
    if(!svSurveyData) return;
    switch(a){
      case 'setTitle': svSurveyData.title = t.value; break;
      case 'setDesc': svSurveyData.desc = t.value; break;
      case 'setStartDate': svSurveyData.startDate = t.value; break;
      case 'setEndDate': svSurveyData.endDate = t.value; break;
      case 'setEndTime': svSurveyData.endTime = t.value; break;
      case 'setSectionTitle': if(svSurveyData.sections[parseInt(t.dataset.svSi)]) svSurveyData.sections[parseInt(t.dataset.svSi)].title = t.value; break;
      case 'setSectionDesc': if(svSurveyData.sections[parseInt(t.dataset.svSi)]) svSurveyData.sections[parseInt(t.dataset.svSi)].desc = t.value; break;
      case 'setQText': {
        const si2 = parseInt(t.dataset.svSi), qi2 = parseInt(t.dataset.svQi);
        if(svSurveyData.sections[si2] && svSurveyData.sections[si2].questions[qi2]) svSurveyData.sections[si2].questions[qi2].text = t.value;
        break;
      }
      case 'setQDesc': {
        const si3 = parseInt(t.dataset.svSi), qi3 = parseInt(t.dataset.svQi);
        if(svSurveyData.sections[si3] && svSurveyData.sections[si3].questions[qi3]) svSurveyData.sections[si3].questions[qi3].desc = t.value;
        break;
      }
      case 'setOption': {
        const si4 = parseInt(t.dataset.svSi), qi4 = parseInt(t.dataset.svQi), oi4 = parseInt(t.dataset.svOi);
        if(svSurveyData.sections[si4] && svSurveyData.sections[si4].questions[qi4] && svSurveyData.sections[si4].questions[qi4].options)
          svSurveyData.sections[si4].questions[qi4].options[oi4] = t.value;
        break;
      }
      case 'setShortLabel': {
        const si5 = parseInt(t.dataset.svSi), qi5 = parseInt(t.dataset.svQi);
        if(svSurveyData.sections[si5] && svSurveyData.sections[si5].questions[qi5]) svSurveyData.sections[si5].questions[qi5].shortLabel = t.value;
        break;
      }
      case 'setGridRow': {
        const si6 = parseInt(t.dataset.svSi), qi6 = parseInt(t.dataset.svQi), ri = parseInt(t.dataset.svRi);
        if(svSurveyData.sections[si6] && svSurveyData.sections[si6].questions[qi6] && svSurveyData.sections[si6].questions[qi6].gridRows)
          svSurveyData.sections[si6].questions[qi6].gridRows[ri] = t.value;
        break;
      }
      case 'setGridCol': {
        const si7 = parseInt(t.dataset.svSi), qi7 = parseInt(t.dataset.svQi), ci = parseInt(t.dataset.svCi);
        if(svSurveyData.sections[si7] && svSurveyData.sections[si7].questions[qi7] && svSurveyData.sections[si7].questions[qi7].gridCols)
          svSurveyData.sections[si7].questions[qi7].gridCols[ci] = t.value;
        break;
      }
      case 'transUpdatePreview': svTransUpdatePreview(); break;
    }
  });

