import mongoose, { Schema } from "mongoose";
import { type RAI } from "@packages/acl/types.js";
import { type BaseDocument } from "@packages/mongoose/plugins/base.plugin.js";

export interface IResource extends BaseDocument<RAI> {
    _id: RAI;
    path: string;
    name: string;
    description: string;

    // Boolean flags to indicate the state of the resource
    is_enabled: boolean;
    is_root: boolean;

    // Methods of the resource
    enable(): Promise<IResource>;
    disable(): Promise<IResource>;

}

const ResourceSchema: Schema = new Schema(
    {
        id: { type: String, required: true, unique: true },
        path: { type: String, required: true },
        name: { type: String },
        description: { type: String },

        is_enabled: { type: Boolean, default: true },
        is_root: { type: Boolean, default: false },
    },
    {
        methods: {
            enable: async function (this: IResource) {
                this.is_enabled = true;
                await this.save();
                return this;
            },
            disable: async function (this: IResource) {
                this.is_enabled = false;
                await this.save();
                return this;
            },
        },
    }
);

export const ResourceModel = mongoose.model<IResource>("Resource", ResourceSchema);