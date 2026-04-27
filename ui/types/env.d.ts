// ui/types/env.d.ts

// Asset declarations
declare module "*.svg" {
    const content: string;
    export default content;
}

declare module "*.png" {
    const content: string;
    export default content;
}

declare module "*.jpg" {
    const content: string;
    export default content;
}

declare module "*.webp" {
    const content: string;
    export default content;
}

// CSS Modules
declare module '*.module.css' {
    const classes: { [key: string]: string };
    export default classes;
}

// Chrome extension API type definitions
declare namespace chrome {
    namespace runtime {
        const id: string;
        const lastError: { message: string } | undefined;

        // Overloads for sendMessage
        function sendMessage(
            message: any,
            callback?: (response: any) => void,
        ): void;
        function sendMessage(
            extensionId: string,
            message: any,
            callback?: (response: any) => void,
        ): void;

        // onMessage event with add/remove listener methods
        const onMessage: {
            addListener(
                callback: (
                    message: any,
                    sender: any,
                    sendResponse: (response?: any) => void,
                ) => void,
            ): void;
            removeListener(
                callback: (
                    message: any,
                    sender: any,
                    sendResponse: (response?: any) => void,
                ) => void,
            ): void;
        };
    }

    namespace tabs {
        interface Tab {
            id?: number;
            url?: string;
            title?: string;
            windowId?: number;
        }

        // getCurrent
        function getCurrent(): Promise<Tab>;
        function getCurrent(callback: (tab: Tab) => void): void;

        // get
        function get(tabId: number): Promise<Tab>;
        function get(tabId: number, callback: (tab: Tab) => void): void;

        // query
        function query(queryInfo: any): Promise<Tab[]>;
        function query(queryInfo: any, callback: (tabs: Tab[]) => void): void;

        // update
        function update(tabId: number, updateProperties: any): Promise<Tab>;
        function update(
            tabId: number,
            updateProperties: any,
            callback: (tab: Tab) => void,
        ): void;

        // create
        function create(createProperties: any): Promise<Tab>;
        function create(createProperties: any, callback: (tab: Tab) => void): void;

        // remove
        function remove(tabIds: number | number[]): Promise<void>;
        function remove(tabIds: number | number[], callback: () => void): void;

        // reload
        function reload(tabId?: number, reloadProperties?: any): Promise<void>;
        function reload(
            tabId: number,
            reloadProperties: any,
            callback: () => void,
        ): void;

        // sendMessage
        function sendMessage(
            tabId: number,
            message: any,
            options?: any,
        ): Promise<any>;
        function sendMessage(
            tabId: number,
            message: any,
            responseCallback: (response: any) => void,
        ): void;
        function sendMessage(
            tabId: number,
            message: any,
            options: any,
            responseCallback: (response: any) => void,
        ): void;

        // events (minimal)
        const onUpdated: {
            addListener(
                callback: (tabId: number, changeInfo: any, tab: Tab) => void,
            ): void;
            removeListener(
                callback: (tabId: number, changeInfo: any, tab: Tab) => void,
            ): void;
        };
        const onRemoved: {
            addListener(callback: (tabId: number, removeInfo?: any) => void): void;
            removeListener(callback: (tabId: number, removeInfo?: any) => void): void;
        };
        const onCreated: {
            addListener(callback: (tab: Tab) => void): void;
            removeListener(callback: (tab: Tab) => void): void;
        };
        const onActivated: {
            addListener(callback: (activeInfo: any) => void): void;
            removeListener(callback: (activeInfo: any) => void): void;
        };
    }
}
