// react-native-web 未附 tsc 可用的型別宣告——此處提供起手所需元件的最小 ambient 宣告。
// 日後上原生（react-native）時，改用真正的 RN 型別（或 @types/react-native + bundler 別名）取代。
declare module "react-native-web" {
  import type { ComponentType, ReactNode } from "react";
  type StyleValue = Record<string, unknown>;
  type Style = StyleValue | Array<StyleValue | false | null | undefined>;

  export interface ViewProps {
    style?: Style;
    children?: ReactNode;
  }
  export interface TextProps {
    style?: Style;
    numberOfLines?: number;
    children?: ReactNode;
      /** react-native-web 渲染成 `data-testid`。 */
    testID?: string;
    selectable?: boolean;
}
  export interface TextInputProps {
    style?: Style;
    value?: string;
    placeholder?: string;
    placeholderTextColor?: string;
    secureTextEntry?: boolean;
    editable?: boolean;
    multiline?: boolean;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    autoCorrect?: boolean;
    onChangeText?: (text: string) => void;
    "aria-label"?: string;
    /** react-native-web 渲染成 `data-testid`（測試用選擇器）。 */
    testID?: string;
  }
  export interface PressableProps {
    style?: Style;
    onPress?: () => void;
    disabled?: boolean;
    children?: ReactNode;
    accessibilityRole?: string;
    "aria-label"?: string;
    testID?: string;
  }
  export interface ScrollViewProps {
    style?: Style;
    contentContainerStyle?: Style;
    horizontal?: boolean;
    children?: ReactNode;
  }
  /** 圖片（ADR-0102 縮圖顯示）；`source.uri` 可為 http(s)、blob: 或 data: URL。 */
  export interface ImageProps {
    style?: Style;
    source: { uri: string | undefined };
    accessibilityLabel?: string;
  }
  export const Image: ComponentType<ImageProps>;
  export const View: ComponentType<ViewProps>;
  export const Text: ComponentType<TextProps>;
  export const TextInput: ComponentType<TextInputProps>;
  export const Pressable: ComponentType<PressableProps>;
  export const ScrollView: ComponentType<ScrollViewProps>;
  export const StyleSheet: {
    create<T extends Record<string, StyleValue>>(styles: T): T;
  };
}
